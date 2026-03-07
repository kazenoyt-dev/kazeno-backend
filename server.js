const admin = require('firebase-admin');
const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer'); 

const app = express();
const PORT = process.env.PORT || 3000;

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

console.log("🚀 Kazeno Backend Server (Anti-Popup Pro v5) စတင်လည်ပတ်နေပါပြီ...");

db.collection('orders').where('status', '==', 'Pending').onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
            const order = change.doc.data();
            const orderId = change.doc.id;
            let finalScreenshotUrl = ""; 

            console.log(`📦 အော်ဒါအသစ် ဝင်လာပါပြီ: [${order.orderId}] - Product: ${order.item}`);

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
                    
                    let userId = ""; let zoneId = "";
                    const match = order.playerId.match(/(\d+)\s*\(\s*(\d+)\s*\)/);
                    if (match) { userId = match[1]; zoneId = match[2]; } 
                    else { userId = order.playerId.replace(/\D/g, ''); }

                    const browser = await puppeteer.launch({
                        headless: "new",
                        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1280,800']
                    });

                    try {
                        const page = await browser.newPage();
                        await page.setViewport({ width: 1280, height: 800 }); 

                        const cookies = smileCookie.split(';').map(pair => {
                            let [name, ...value] = pair.split('=');
                            return { name: name.trim(), value: value.join('=').trim(), domain: '.smile.one' };
                        });
                        await page.setCookie(...cookies);

                        // PH Server သို့ ဦးစွာ သွားကြည့်မည်
                        await page.goto('https://www.smile.one/ph/merchant/mobilelegends?source=other', { waitUntil: 'networkidle2', timeout: 60000 });
                        await new Promise(r => setTimeout(r, 3000));

                        // 💡 (၁) ပိတ်ဆို့နေသော Popup များကို အတင်းပိတ်ခြင်း 💡
                        await page.evaluate(() => {
                            const closeSelectors = ['.system_install_cancel', '.close-btn', '.swal2-cancel', '.swal2-close', '#system_install_cancel', '.layui-layer-setwin .layui-layer-close'];
                            closeSelectors.forEach(s => {
                                let el = document.querySelector(s);
                                if(el) el.click();
                            });
                        });
                        await new Promise(r => setTimeout(r, 1000));

                        // 💡 (၂) ID အကွက်ကို ပေါ်လာသည်အထိ စောင့်ခြင်း နှင့် ထည့်ခြင်း 💡
                        const idInpSelector = 'input[name="userid"]';
                        await page.waitForSelector(idInpSelector, { visible: true, timeout: 20000 });

                        await page.evaluate((uid, zid) => {
                            const idInp = document.querySelector('input[name="userid"]');
                            const zoneInp = document.querySelector('input[name="zoneid"]');
                            
                            // Native React/Vue Value Setter
                            const nativeValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                            
                            if (idInp) {
                                nativeValueSetter.call(idInp, uid);
                                idInp.dispatchEvent(new Event('input', { bubbles: true }));
                                idInp.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                            if (zoneInp && zid) {
                                nativeValueSetter.call(zoneInp, zid);
                                zoneInp.dispatchEvent(new Event('input', { bubbles: true }));
                                zoneInp.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                        }, userId, zoneId);

                        // 💡 (၃) Product ရွေးခြင်း 💡
                        const pSelector = `[data-id="${productData.smileId}"]`;
                        await page.waitForSelector(pSelector, { visible: true, timeout: 10000 });
                        await page.click(pSelector);
                        await new Promise(r => setTimeout(r, 1000));

                        // 💡 (၄) Buy ခလုတ်မနှိပ်မီ ဓာတ်ပုံအရင်ရိုက်ခြင်း (ID ဝင်မဝင် စစ်ရန်) 💡
                        try {
                            const base64Img = await page.screenshot({ encoding: 'base64' });
                            const imgParams = new URLSearchParams(); imgParams.append('image', base64Img);
                            const imgRes = await axios.post('https://api.imgbb.com/1/upload?key=f0d759dd374df91104867c6701e199f2', imgParams.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }});
                            if(imgRes.data && imgRes.data.data) finalScreenshotUrl = imgRes.data.data.url;
                        } catch(e) {}

                        // 💡 (၅) Buy နှိပ်ခြင်း 💡
                        await page.click('.buy-btn, #buy_btn');
                        await new Promise(r => setTimeout(r, 4000));

                        // 🔍 စာသားများကို ဖတ်ခြင်း
                        const uiMessage = await page.evaluate(() => {
                            let msg = "";
                            let popups = document.querySelectorAll('.layui-layer-content, .swal2-html-container, .swal-title, .error-msg');
                            popups.forEach(p => { if(p.innerText.trim().length > 2) msg += p.innerText.trim() + " "; });
                            return msg;
                        });

                        if (uiMessage && !uiMessage.toLowerCase().includes('success') && !uiMessage.toLowerCase().includes('အောင်မြင်')) {
                            throw new Error(`Smile One: "${uiMessage}"`);
                        }

                        await db.collection('orders').doc(orderId).update({ status: 'Completed' });

                        if(config.tgBotToken && config.tgChatId) {
                            let tgText = `✅ <b>AUTO-TOPUP SUCCESS!</b>\nOrder: ${order.orderId}\nID: ${order.playerId}\nItem: ${order.item}`;
                            if(finalScreenshotUrl) tgText += `\n📸 <a href="${finalScreenshotUrl}">စက်ရုပ်ID ထည့်ထားသောပုံကို ကြည့်ရန်</a>`;
                            await axios.post(`https://api.telegram.org/bot${config.tgBotToken}/sendMessage`, { chat_id: config.tgChatId, text: tgText, parse_mode: "HTML", message_thread_id: config.tgOrderTopicId ? parseInt(config.tgOrderTopicId) : undefined });
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
                    let tgText = `⚠️ <b>AUTO-TOPUP FAILED</b> ⚠️\nOrder: ${order.orderId}\nReason: ${error.message}`;
                    if(finalScreenshotUrl) tgText += `\n\n📸 <a href="${finalScreenshotUrl}">နောက်ဆုံးအခြေအနေပုံကို ကြည့်ရန်</a>`;
                    await axios.post(`https://api.telegram.org/bot${config.tgBotToken}/sendMessage`, { chat_id: config.tgChatId, text: tgText, parse_mode: "HTML", message_thread_id: config.tgOrderTopicId ? parseInt(config.tgOrderTopicId) : undefined });
                }
            }
        }
    });
});

app.get('/', (req, res) => { res.send('✅ Kazeno Backend is Active'); });
app.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });

