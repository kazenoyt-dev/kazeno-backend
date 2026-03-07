const admin = require('firebase-admin');
const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer'); 

const app = express();
const PORT = process.env.PORT || 3000;

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

console.log("🚀 Kazeno Backend Server (Smart Puppeteer) စတင်လည်ပတ်နေပါပြီ...");

db.collection('orders').where('status', '==', 'Pending').onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
            const order = change.doc.data();
            const orderId = change.doc.id;

            console.log(`📦 အော်ဒါအသစ် ဝင်လာပါပြီ: [${order.orderId}] - Product: ${order.item}`);

            try {
                const configDoc = await db.collection('settings').doc('app_config').get();
                const config = configDoc.data() || {};
                const smileCookie = config.cookieSmile;

                const productSnapshot = await db.collection('products').where('name', '==', order.item).limit(1).get();
                if (productSnapshot.empty) throw new Error("Product အချက်အလက်ကို Database တွင် ရှာမတွေ့ပါ။");
                const productData = productSnapshot.docs[0].data();

                if (productData.topupType === 'Auto') {
                    if (!smileCookie) throw new Error("Smile One Cookie ထည့်သွင်းထားခြင်း မရှိပါ။");
                    if (!productData.smileId) throw new Error("ဤ Product အတွက် 'Smile ID' မရှိပါ။");

                    await db.collection('orders').doc(orderId).update({ status: 'Processing' });
                    console.log(`🔄 [${order.orderId}] Processing... Browser ဖွင့်နေပါသည်...`);

                    let userId = ""; let zoneId = "";
                    const match = order.playerId.match(/(\d+)\s*\(\s*(\d+)\s*\)/);
                    if (match) { userId = match[1]; zoneId = match[2]; } 
                    else { userId = order.playerId.replace(/\D/g, ''); }

                    const browser = await puppeteer.launch({
                        headless: "new",
                        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--disable-gpu', '--single-process']
                    });

                    try {
                        const page = await browser.newPage();

                        // ၁။ Cookie များ ထည့်ခြင်း
                        const cookies = smileCookie.split(';').map(pair => {
                            let [name, ...value] = pair.split('=');
                            return { name: name.trim(), value: value.join('=').trim(), domain: '.smile.one' };
                        });
                        await page.setCookie(...cookies);

                        // ၂။ Smile One စာမျက်နှာသို့ ဝင်ခြင်း
                        await page.goto('https://www.smile.one/merchant/mobilelegends', { waitUntil: 'networkidle2', timeout: 60000 });

                        // Login ပြန်တောင်းနေသလား စစ်ဆေးခြင်း
                        if (page.url().includes('login')) {
                            throw new Error("Cookie သက်တမ်းကုန်နေပါသည် (Login ဝင်ရန် တောင်းဆိုနေပါသည်)။ Admin Panel တွင် Cookie အသစ် ပြန်ထည့်ပေးပါ။");
                        }

                        // ၃။ ID များနှင့် Package ကို ရွေးချယ်ခြင်း
                        await page.evaluate((uid, zid, pid) => {
                            let idInput = document.querySelector('input[name="userid"]') || document.querySelector('.userid');
                            let zoneInput = document.querySelector('input[name="zoneid"]') || document.querySelector('.zoneid');
                            if(idInput) { idInput.value = uid; idInput.dispatchEvent(new Event('input', { bubbles: true })); }
                            if(zoneInput) { zoneInput.value = zid; zoneInput.dispatchEvent(new Event('input', { bubbles: true })); }

                            let productBox = document.querySelector(`[data-id="${pid}"]`) || document.querySelector(`[productid="${pid}"]`);
                            if(productBox) productBox.click();
                        }, userId, zoneId, productData.smileId);

                        await new Promise(r => setTimeout(r, 1000)); // Product ရွေးပြီး ၁ စက္ကန့်စောင့်မည်

                        // ၄။ Buy နှိပ်ခြင်း
                        await page.evaluate(() => {
                            let buyBtn = document.querySelector('.buy-btn') || document.querySelector('#buy_btn') || document.querySelector('.btn-pay');
                            if(buyBtn) buyBtn.click();
                        });

                        console.log(`⏳ [${order.orderId}] ဝယ်ယူရန် ခလုတ်နှိပ်လိုက်ပါပြီ။ စနစ်မှ အလုပ်လုပ်နေသည်...`);
                        
                        // ၅။ 💡 Smile One မှ ပြန်ပေါ်လာမည့် အဖြေစာသား (Error/Success) ကို ဖတ်ခြင်း 💡
                        await new Promise(r => setTimeout(r, 4000)); // စာသားပေါ်လာရန် ၄ စက္ကန့် စောင့်မည်

                        const uiMessage = await page.evaluate(() => {
                            let msg = "";
                            // Layui Layer (Smile One အသုံးများသော Alert Box)
                            let layui = document.querySelector('.layui-layer-content');
                            if (layui && layui.innerText) msg = layui.innerText.trim();
                            // SweetAlert Box
                            if(!msg) {
                                let swal = document.querySelector('.swal-title') || document.querySelector('.swal-text') || document.querySelector('.swal2-html-container');
                                if (swal && swal.innerText) msg = swal.innerText.trim();
                            }
                            // Error Box အခြား
                            if(!msg) {
                                let errBox = document.querySelector('.error-msg') || document.querySelector('.toast-message');
                                if (errBox && errBox.innerText) msg = errBox.innerText.trim();
                            }
                            return msg;
                        });

                        // စာသားတစ်ခုခု ဖတ်လို့ရခဲ့လျှင်
                        if (uiMessage) {
                            // 'success' သို့မဟုတ် 'အောင်မြင်' ဆိုသည့် စကားလုံးမပါလျှင် Error အဖြစ် သတ်မှတ်မည်
                            if (!uiMessage.toLowerCase().includes('success') && !uiMessage.toLowerCase().includes('အောင်မြင်')) {
                                throw new Error(`Smile One: "${uiMessage}"`);
                            }
                        }

                        // ဘာ Error မှ မတက်ဘဲ အောင်မြင်သွားလျှင် Completed ပြောင်းမည်
                        await db.collection('orders').doc(orderId).update({ status: 'Completed' });
                        console.log(`✅ [${order.orderId}] အောင်မြင်စွာ ဖြည့်သွင်းပြီးပါပြီ!`);

                        if(config.tgBotToken && config.tgChatId) {
                            let tgPayload = { chat_id: config.tgChatId, text: `✅ <b>AUTO-TOPUP SUCCESS!</b>\nOrder: ${order.orderId}\nID: ${order.playerId}\nItem: ${order.item}`, parse_mode: "HTML" };
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
                    let tgPayload = { chat_id: config.tgChatId, text: `⚠️ <b>AUTO-TOPUP FAILED</b> ⚠️\nOrder: ${order.orderId}\nReason: ${error.message}\nကျေးဇူးပြု၍ Admin မှ Manual သွားဖြည့်ပေးပါ။`, parse_mode: "HTML" };
                    if(config.tgOrderTopicId) tgPayload.message_thread_id = parseInt(config.tgOrderTopicId);
                    await axios.post(`https://api.telegram.org/bot${config.tgBotToken}/sendMessage`, tgPayload).catch(e=>{});
                }
            }
        }
    });
});

app.get('/', (req, res) => { res.send('✅ Kazeno Puppeteer Backend is Active and Running 24/7!'); });
app.listen(PORT, () => { console.log(`🌐 Web Server သည် Port ${PORT} တွင် အလုပ်လုပ်နေပါသည်။`); });

