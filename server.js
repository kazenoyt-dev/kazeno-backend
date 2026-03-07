const admin = require('firebase-admin');
const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer'); 

const app = express();
const PORT = process.env.PORT || 3000;

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

console.log("🚀 Kazeno Backend Server (Smart Vision) စတင်လည်ပတ်နေပါပြီ...");

db.collection('orders').where('status', '==', 'Pending').onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
            const order = change.doc.data();
            const orderId = change.doc.id;

            console.log(`📦 အော်ဒါအသစ် ဝင်လာပါပြီ: [${order.orderId}] - Product: ${order.item}`);
            let screenshotUrl = ""; // ဓာတ်ပုံလင့်ခ် သိမ်းရန်

            try {
                const configDoc = await db.collection('settings').doc('app_config').get();
                const config = configDoc.data() || {};
                const smileCookie = config.cookieSmile;

                const productSnapshot = await db.collection('products').where('name', '==', order.item).limit(1).get();
                if (productSnapshot.empty) throw new Error("Product ကို Database တွင် ရှာမတွေ့ပါ။");
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
                        await page.setViewport({ width: 1280, height: 800 }); // ကွန်ပျူတာ မျက်နှာပြင်အရွယ်ထားမည်

                        const cookies = smileCookie.split(';').map(pair => {
                            let [name, ...value] = pair.split('=');
                            return { name: name.trim(), value: value.join('=').trim(), domain: '.smile.one' };
                        });
                        await page.setCookie(...cookies);

                        await page.goto('https://www.smile.one/merchant/mobilelegends', { waitUntil: 'networkidle2', timeout: 60000 });

                        if (page.url().includes('login')) {
                            throw new Error("Cookie သက်တမ်းကုန်နေပါသည် (Login ပြန်တောင်းနေပါသည်)။ Cookie အသစ် ပြန်ထည့်ပါ။");
                        }

                        await page.evaluate((uid, zid, pid) => {
                            let idInput = document.querySelector('input[name="userid"]') || document.querySelector('.userid');
                            let zoneInput = document.querySelector('input[name="zoneid"]') || document.querySelector('.zoneid');
                            if(idInput) { idInput.value = uid; idInput.dispatchEvent(new Event('input', { bubbles: true })); }
                            if(zoneInput) { zoneInput.value = zid; zoneInput.dispatchEvent(new Event('input', { bubbles: true })); }

                            let productBox = document.querySelector(`[data-id="${pid}"]`) || document.querySelector(`[productid="${pid}"]`);
                            if(productBox) productBox.click();
                        }, userId, zoneId, productData.smileId);

                        await new Promise(r => setTimeout(r, 2000));

                        await page.evaluate(() => {
                            let buyBtn = document.querySelector('.buy-btn') || document.querySelector('#buy_btn') || document.querySelector('.btn-pay');
                            if(buyBtn) buyBtn.click();
                        });

                        console.log(`⏳ [${order.orderId}] ဝယ်ယူရန် နှိပ်လိုက်ပါပြီ။ ရလဒ်အား စောင့်ဆိုင်းနေပါသည်...`);
                        await new Promise(r => setTimeout(r, 4500)); // Error Box တက်လာရန် ၄ စက္ကန့် စောင့်မည်

                        // 📸 စက်ရုပ်မှ မျက်နှာပြင်ကို ဓာတ်ပုံရိုက်ယူခြင်း 📸
                        try {
                            const base64Img = await page.screenshot({ encoding: 'base64' });
                            const imgParams = new URLSearchParams();
                            imgParams.append('image', base64Img);
                            const imgRes = await axios.post('https://api.imgbb.com/1/upload?key=f0d759dd374df91104867c6701e199f2', imgParams.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }});
                            if(imgRes.data && imgRes.data.data) screenshotUrl = imgRes.data.data.url;
                        } catch(e) { console.log("Screenshot upload error"); }

                        // 🔍 မျက်နှာပြင်ပေါ်ရှိ စာသားများကို သေချာဖတ်ခြင်း
                        const uiMessage = await page.evaluate(() => {
                            let msg = "";
                            let popups = document.querySelectorAll('.layui-layer-content, .swal2-html-container, .swal-title, .toast-message, .error-msg, .modal-content, .info-box');
                            for (let p of popups) {
                                let text = p.innerText.trim();
                                if (text.length > 2 && text !== "OK" && text !== "Cancel") {
                                    msg += text + " ";
                                }
                            }
                            return msg;
                        });

                        // "အောင်မြင်သည်" ဆိုသည့် စာသား မတွေ့ပါက Error ဟု သတ်မှတ်မည်
                        if (uiMessage && !uiMessage.toLowerCase().includes('success') && !uiMessage.toLowerCase().includes('အောင်မြင်')) {
                            throw new Error(`Smile One: "${uiMessage}"`);
                        }

                        // အောင်မြင်သွားလျှင်
                        await db.collection('orders').doc(orderId).update({ status: 'Completed' });
                        console.log(`✅ [${order.orderId}] အောင်မြင်စွာ ဖြည့်သွင်းပြီးပါပြီ!`);

                        if(config.tgBotToken && config.tgChatId) {
                            let tgText = `✅ <b>AUTO-TOPUP SUCCESS!</b>\nOrder: ${order.orderId}\nID: ${order.playerId}\nItem: ${order.item}`;
                            if(screenshotUrl) tgText += `\n📸 <a href="${screenshotUrl}">စက်ရုပ်ရိုက်ထားသောပုံကို ကြည့်ရန် နှိပ်ပါ</a>`;
                            let tgPayload = { chat_id: config.tgChatId, text: tgText, parse_mode: "HTML" };
                            if(config.tgOrderTopicId) tgPayload.message_thread_id = parseInt(config.tgOrderTopicId);
                            await axios.post(`https://api.telegram.org/bot${config.tgBotToken}/sendMessage`, tgPayload).catch(e=>{});
                        }

                    } catch (err) {
                        throw err; // Error ကို အောက်သို့ ပို့မည်
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
                    // Error တက်ပါက ဓာတ်ပုံလင့်ခ်ကိုပါ ပူးတွဲပို့ပေးမည်
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

