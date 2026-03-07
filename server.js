const admin = require('firebase-admin');
const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer'); 

const app = express();
const PORT = process.env.PORT || 3000;

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

console.log("🚀 Kazeno Backend Server (Pro Vision v3) စတင်လည်ပတ်နေပါပြီ...");

db.collection('orders').where('status', '==', 'Pending').onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
            const order = change.doc.data();
            const orderId = change.doc.id;

            console.log(`📦 အော်ဒါအသစ် ဝင်လာပါပြီ: [${order.orderId}] - Product: ${order.item}`);
            let screenshotUrl = ""; 

            try {
                const configDoc = await db.collection('settings').doc('app_config').get();
                const config = configDoc.data() || {};
                const smileCookie = config.cookieSmile;

                const productSnapshot = await db.collection('products').where('name', '==', order.item).limit(1).get();
                if (productSnapshot.empty) throw new Error("Product ကို Database တွင် ရှာမတွေ့ပါ။");
                const productData = productSnapshot.docs[0].data();

                if (productData.topupType === 'Auto') {
                    if (!smileCookie) throw new Error("Smile One Cookie မရှိပါ။");
                    if (!productData.smileId) throw new Error("Product အတွက် 'Smile ID' မရှိပါ။");

                    await db.collection('orders').doc(orderId).update({ status: 'Processing' });
                    console.log(`🔄 [${order.orderId}] Processing... Browser ဖွင့်နေပါသည်...`);

                    let userId = ""; let zoneId = "";
                    const match = order.playerId.match(/(\d+)\s*\(\s*(\d+)\s*\)/);
                    if (match) { userId = match[1]; zoneId = match[2]; } 
                    else { userId = order.playerId.replace(/\D/g, ''); }

                    const browser = await puppeteer.launch({
                        headless: "new",
                        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
                    });

                    try {
                        const page = await browser.newPage();
                        await page.setViewport({ width: 1280, height: 800 }); 

                        const cookies = smileCookie.split(';').map(pair => {
                            let [name, ...value] = pair.split('=');
                            return { name: name.trim(), value: value.join('=').trim(), domain: '.smile.one' };
                        });
                        await page.setCookie(...cookies);

                        // 💡 (၁) PH Server သို့ တိုက်ရိုက်သွားခြင်း 💡
                        await page.goto('https://www.smile.one/ph/merchant/mobilelegends?source=other', { waitUntil: 'networkidle2', timeout: 60000 });

                        if (page.url().includes('login')) {
                            throw new Error("Cookie သက်တမ်းကုန်နေပါသည် (Login ပြန်တောင်းနေပါသည်)။ Cookie အသစ် ပြန်ထည့်ပါ။");
                        }

                        // 💡 (၂) ပေါ်လာတတ်သော Popup များကို အရင်ရှင်းလင်းခြင်း 💡
                        await page.evaluate(() => {
                            let cancelBtns = document.querySelectorAll('.system_install_cancel, .close-btn, .swal2-cancel, .swal2-close, #system_install_cancel');
                            cancelBtns.forEach(b => b.click());
                        });
                        await new Promise(r => setTimeout(r, 1000));

                        // 💡 (၃) ID များကို လူအစစ်ကဲ့သို့ ကီးဘုတ်ဖြင့် ရိုက်ထည့်ခြင်း (Native Typing) 💡
                        let idSelector = 'input[name="userid"], .userid';
                        let zoneSelector = 'input[name="zoneid"], .zoneid';
                        
                        await page.waitForSelector(idSelector, { visible: true, timeout: 10000 });
                        // အကွက်ထဲရှိ စာဟောင်းများကို ဖျက်ခြင်း
                        await page.click(idSelector, { clickCount: 3 });
                        await page.keyboard.press('Backspace');
                        // လူအစစ်လို ရိုက်ထည့်ခြင်း
                        await page.type(idSelector, String(userId), { delay: 50 });

                        if (zoneId) {
                            await page.waitForSelector(zoneSelector, { visible: true, timeout: 10000 });
                            await page.click(zoneSelector, { clickCount: 3 });
                            await page.keyboard.press('Backspace');
                            await page.type(zoneSelector, String(zoneId), { delay: 50 });
                        }

                        // 💡 (၄) Product အား ရွေးချယ်ခြင်း 💡
                        let pSelector = `[data-id="${productData.smileId}"], [productid="${productData.smileId}"]`;
                        await page.waitForSelector(pSelector, { visible: true, timeout: 10000 });
                        await page.click(pSelector);
                        await new Promise(r => setTimeout(r, 1500));

                        // 💡 (၅) Buy နှိပ်ခြင်း 💡
                        let buySelector = '.buy-btn, #buy_btn, .btn-pay';
                        await page.waitForSelector(buySelector, { visible: true });
                        await page.click(buySelector);

                        console.log(`⏳ [${order.orderId}] ဝယ်ယူရန် နှိပ်လိုက်ပါပြီ။ ရလဒ်အား စောင့်ဆိုင်းနေပါသည်...`);
                        await new Promise(r => setTimeout(r, 5000)); 

                        // 📸 ဓာတ်ပုံရိုက်ယူခြင်း
                        try {
                            const base64Img = await page.screenshot({ encoding: 'base64' });
                            const imgParams = new URLSearchParams(); imgParams.append('image', base64Img);
                            const imgRes = await axios.post('https://api.imgbb.com/1/upload?key=f0d759dd374df91104867c6701e199f2', imgParams.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }});
                            if(imgRes.data && imgRes.data.data) screenshotUrl = imgRes.data.data.url;
                        } catch(e) { console.log("Screenshot error"); }

                        // 🔍 စာသားများကို သေချာဖတ်ခြင်း
                        const uiMessage = await page.evaluate(() => {
                            let msg = "";
                            let popups = document.querySelectorAll('.layui-layer-content, .swal2-html-container, .swal-title, .toast-message, .error-msg');
                            for (let p of popups) {
                                let text = p.innerText.trim();
                                if (text.length > 2 && text !== "OK" && text !== "Cancel") msg += text + " ";
                            }
                            return msg;
                        });

                        if (uiMessage && !uiMessage.toLowerCase().includes('success') && !uiMessage.toLowerCase().includes('အောင်မြင်')) {
                            throw new Error(`Smile One: "${uiMessage}"`);
                        }

                        await db.collection('orders').doc(orderId).update({ status: 'Completed' });
                        console.log(`✅ [${order.orderId}] အောင်မြင်စွာ ဖြည့်သွင်းပြီးပါပြီ!`);

                        if(config.tgBotToken && config.tgChatId) {
                            let tgText = `✅ <b>AUTO-TOPUP SUCCESS!</b>\nOrder: ${order.orderId}\nID: ${order.playerId}\nItem: ${order.item}`;
                            if(screenshotUrl) tgText += `\n📸 <a href="${screenshotUrl}">အောင်မြင်သွားသော ပုံကိုကြည့်ရန်</a>`;
                            let tgPayload = { chat_id: config.tgChatId, text: tgText, parse_mode: "HTML" };
                            if(config.tgOrderTopicId) tgPayload.message_thread_id = parseInt(config.tgOrderTopicId);
                            await axios.post(`https://api.telegram.org/bot${config.tgBotToken}/sendMessage`, tgPayload).catch(e=>{});
                        }

                    } catch (err) {
                        throw err; 
                    } finally {
                        await browser.close(); 
                    }
                }
            } catch (error) {
                console.log(`❌ Auto-Topup ကျရှုံးပါသည်: ${error.message}`);
                const configDoc = await db.collection('settings').doc('app_config').get();
                const config = configDoc.data() || {};
                if(config.tgBotToken && config.tgChatId) {
                    let tgText = `⚠️ <b>AUTO-TOPUP FAILED</b> ⚠️\nOrder: ${order.orderId}\nReason: ${error.message}\nကျေးဇူးပြု၍ Admin မှ Manual သွားဖြည့်ပေးပါ။`;
                    if(screenshotUrl) tgText += `\n\n📸 <a href="${screenshotUrl}">Error ဓာတ်ပုံကို ကြည့်ရန် နှိပ်ပါ</a>`;
                    
                    let tgPayload = { chat_id: config.tgChatId, text: tgText, parse_mode: "HTML" };
                    if(config.tgOrderTopicId) tgPayload.message_thread_id = parseInt(config.tgOrderTopicId);
                    await axios.post(`https://api.telegram.org/bot${config.tgBotToken}/sendMessage`, tgPayload).catch(e=>{});
                }
            }
        }
    });
});

app.get('/', (req, res) => { res.send('✅ Kazeno Puppeteer Backend is Active and Running 24/7!'); });
app.listen(PORT, () => { console.log(`🌐 Web Server သည် Port ${PORT} တွင် အလုပ်လုပ်နေပါသည်။`); });

