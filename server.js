const admin = require('firebase-admin');
const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer'); 

const app = express();
const PORT = process.env.PORT || 3000;

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

console.log("🚀 Kazeno Backend Server (Anti-Blind Pro v4) စတင်လည်ပတ်နေပါပြီ...");

db.collection('orders').where('status', '==', 'Pending').onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
            const order = change.doc.data();
            const orderId = change.doc.id;
            let finalScreenshotUrl = ""; // ဓာတ်ပုံလင့်ခ်ကို အမြဲသိမ်းထားရန်

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
                    console.log(`🔄 [${order.orderId}] Processing... Browser ဖွင့်နေပါသည်...`);

                    let userId = ""; let zoneId = "";
                    const match = order.playerId.match(/(\d+)\s*\(\s*(\d+)\s*\)/);
                    if (match) { userId = match[1]; zoneId = match[2]; } 
                    else { userId = order.playerId.replace(/\D/g, ''); }

                    let browser = null;
                    let page = null;

                    try {
                        browser = await puppeteer.launch({
                            headless: "new",
                            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1280,800']
                        });
                        
                        page = await browser.newPage();
                        await page.setViewport({ width: 1280, height: 800 }); 

                        const cookies = smileCookie.split(';').map(pair => {
                            let [name, ...value] = pair.split('=');
                            return { name: name.trim(), value: value.join('=').trim(), domain: '.smile.one' };
                        });
                        await page.setCookie(...cookies);

                        await page.goto('https://www.smile.one/merchant/mobilelegends', { waitUntil: 'networkidle2', timeout: 60000 });
                        await new Promise(r => setTimeout(r, 2000));

                        // 💡 Popup များကို အတင်းပိတ်ခြင်း
                        await page.evaluate(() => {
                            let cancelBtns = document.querySelectorAll('.system_install_cancel, .close-btn, .swal2-cancel, .swal2-close');
                            cancelBtns.forEach(b => b.click());
                        });

                        // 💡 ID များကို Code အတွင်းပိုင်းမှ အတင်း (Force) ထည့်သွင်းခြင်း (React Hack)
                        await page.evaluate((uid, zid) => {
                            let idInp = document.querySelector('input[name="userid"]') || document.querySelector('.userid');
                            let zoneInp = document.querySelector('input[name="zoneid"]') || document.querySelector('.zoneid');
                            let setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                            
                            if(idInp) { setter.call(idInp, uid); idInp.dispatchEvent(new Event('input', {bubbles:true})); }
                            if(zoneInp && zid) { setter.call(zoneInp, zid); zoneInp.dispatchEvent(new Event('input', {bubbles:true})); }
                        }, userId, zoneId);

                        await new Promise(r => setTimeout(r, 1000));

                        // 💡 Product အား ရွေးချယ်ခြင်း
                        await page.evaluate((pid) => {
                            let productBox = document.querySelector(`[data-id="${pid}"]`) || document.querySelector(`[productid="${pid}"]`);
                            if(productBox) productBox.click();
                        }, productData.smileId);

                        await new Promise(r => setTimeout(r, 1000));

                        // 💡 Buy နှိပ်ခြင်း
                        await page.evaluate(() => {
                            let buyBtn = document.querySelector('.buy-btn') || document.querySelector('#buy_btn') || document.querySelector('.btn-pay');
                            if(buyBtn) buyBtn.click();
                        });

                        console.log(`⏳ [${order.orderId}] ဝယ်ယူရန် နှိပ်လိုက်ပါပြီ။`);
                        await new Promise(r => setTimeout(r, 4500)); 

                        // 📸 ဓာတ်ပုံရိုက်ယူခြင်း (အောင်မြင်သည်ဖြစ်စေ၊ ကျရှုံးသည်ဖြစ်စေ)
                        try {
                            const base64Img = await page.screenshot({ encoding: 'base64' });
                            const imgParams = new URLSearchParams(); imgParams.append('image', base64Img);
                            const imgRes = await axios.post('https://api.imgbb.com/1/upload?key=f0d759dd374df91104867c6701e199f2', imgParams.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }});
                            if(imgRes.data && imgRes.data.data) finalScreenshotUrl = imgRes.data.data.url;
                        } catch(e) { console.log("Screenshot upload failed"); }

                        // 🔍 စာသားများကို ဖတ်ခြင်း
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

                        // အောင်မြင်ပါက
                        await db.collection('orders').doc(orderId).update({ status: 'Completed' });
                        console.log(`✅ [${order.orderId}] အောင်မြင်စွာ ဖြည့်သွင်းပြီးပါပြီ!`);

                        if(config.tgBotToken && config.tgChatId) {
                            let tgText = `✅ <b>AUTO-TOPUP SUCCESS!</b>\nOrder: ${order.orderId}\nID: ${order.playerId}\nItem: ${order.item}`;
                            if(finalScreenshotUrl) tgText += `\n📸 <a href="${finalScreenshotUrl}">အောင်မြင်သွားသော ပုံကိုကြည့်ရန်</a>`;
                            let tgPayload = { chat_id: config.tgChatId, text: tgText, parse_mode: "HTML" };
                            if(config.tgOrderTopicId) tgPayload.message_thread_id = parseInt(config.tgOrderTopicId);
                            await axios.post(`https://api.telegram.org/bot${config.tgBotToken}/sendMessage`, tgPayload).catch(e=>{});
                        }

                    } catch (err) {
                        // ❌ Error တက်ခဲ့လျှင် ဓာတ်ပုံရိုက်ဖို့ ထပ်ကြိုးစားမည်
                        if (page && !finalScreenshotUrl) {
                            try {
                                const base64Img = await page.screenshot({ encoding: 'base64' });
                                const imgParams = new URLSearchParams(); imgParams.append('image', base64Img);
                                const imgRes = await axios.post('https://api.imgbb.com/1/upload?key=f0d759dd374df91104867c6701e199f2', imgParams.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }});
                                if(imgRes.data && imgRes.data.data) finalScreenshotUrl = imgRes.data.data.url;
                            } catch(e) {}
                        }
                        throw err; // Main Try-Catch သို့ Error ပို့မည်
                    } finally {
                        if (browser) await browser.close(); 
                    }
                }
            } catch (error) {
                console.log(`❌ Auto-Topup ကျရှုံးပါသည်: ${error.message}`);
                const configDoc = await db.collection('settings').doc('app_config').get();
                const config = configDoc.data() || {};
                if(config.tgBotToken && config.tgChatId) {
                    let tgText = `⚠️ <b>AUTO-TOPUP FAILED</b> ⚠️\nOrder: ${order.orderId}\nReason: ${error.message}\nကျေးဇူးပြု၍ Admin မှ Manual သွားဖြည့်ပေးပါ။`;
                    if(finalScreenshotUrl) tgText += `\n\n📸 <a href="${finalScreenshotUrl}">Error ဓာတ်ပုံကို ကြည့်ရန် နှိပ်ပါ</a>`;
                    
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

