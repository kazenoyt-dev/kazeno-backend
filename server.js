const admin = require('firebase-admin');
const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer'); // 👈 Browser အသစ်စနစ်

const app = express();
const PORT = process.env.PORT || 3000;

// Firebase ချိတ်ဆက်ခြင်း
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

console.log("🚀 Kazeno Backend Server (Puppeteer Version) စတင်လည်ပတ်နေပါပြီ...");

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
                    console.log(`🔄 [${order.orderId}] Processing... Browser နောက်ကွယ်တွင် ဖွင့်နေပါသည်...`);

                    let userId = ""; let zoneId = "";
                    const match = order.playerId.match(/(\d+)\s*\(\s*(\d+)\s*\)/);
                    if (match) { userId = match[1]; zoneId = match[2]; } 
                    else { userId = order.playerId.replace(/\D/g, ''); }

                    // 💡 Render ၏ Free RAM ဖြင့် ကိုက်ညီစေရန် အထူးပြုလုပ်ထားသော Browser 💡
                    const browser = await puppeteer.launch({
                        headless: "new",
                        args: [
                            '--no-sandbox',
                            '--disable-setuid-sandbox',
                            '--disable-dev-shm-usage',
                            '--disable-accelerated-2d-canvas',
                            '--disable-gpu',
                            '--single-process'
                        ]
                    });

                    try {
                        const page = await browser.newPage();

                        // ၁။ Cookie များကို Browser ထဲသို့ ထည့်သွင်းခြင်း
                        const cookies = smileCookie.split(';').map(pair => {
                            let [name, ...value] = pair.split('=');
                            return { name: name.trim(), value: value.join('=').trim(), domain: '.smile.one' };
                        });
                        await page.setCookie(...cookies);

                        // ၂။ Smile One (MLBB) စာမျက်နှာသို့ ဝင်ရောက်ခြင်း
                        await page.goto('https://www.smile.one/merchant/mobilelegends', { waitUntil: 'networkidle2', timeout: 60000 });

                        // ၃။ လူအစစ်ကဲ့သို့ ID ရိုက်ထည့်ပြီး Buy နှိပ်ခြင်း
                        await page.evaluate((uid, zid, pid) => {
                            // User ID နှင့် Zone ID ထည့်ခြင်း
                            let idInput = document.querySelector('input[name="userid"]') || document.querySelector('.userid');
                            let zoneInput = document.querySelector('input[name="zoneid"]') || document.querySelector('.zoneid');
                            if(idInput) { idInput.value = uid; idInput.dispatchEvent(new Event('input', { bubbles: true })); }
                            if(zoneInput) { zoneInput.value = zid; zoneInput.dispatchEvent(new Event('input', { bubbles: true })); }

                            // Product ID အတိုင်း Package ကို နှိပ်ခြင်း
                            let productBox = document.querySelector(`[data-id="${pid}"]`) || document.querySelector(`[productid="${pid}"]`);
                            if(productBox) productBox.click();

                            // Buy နှိပ်ခြင်း
                            let buyBtn = document.querySelector('.buy-btn') || document.querySelector('#buy_btn') || document.querySelector('.btn-pay');
                            if(buyBtn) buyBtn.click();
                        }, userId, zoneId, productData.smileId);

                        console.log(`⏳ [${order.orderId}] ဝယ်ယူရန် ခလုတ်နှိပ်လိုက်ပါပြီ။ စနစ်မှ အလုပ်လုပ်နေသည်...`);
                        
                        // Action အလုပ်လုပ်ရန် ၅ စက္ကန့် စောင့်ဆိုင်းပေးမည်
                        await new Promise(r => setTimeout(r, 5000));

                        // အောင်မြင်ပါက Completed သို့ ပြောင်းမည်
                        await db.collection('orders').doc(orderId).update({ status: 'Completed' });
                        console.log(`✅ [${order.orderId}] အောင်မြင်စွာ ဖြည့်သွင်းပြီးပါပြီ!`);

                        // Telegram သို့ အောင်မြင်ကြောင်း ပို့မည်
                        if(config.tgBotToken && config.tgChatId) {
                            let tgPayload = { chat_id: config.tgChatId, text: `✅ <b>AUTO-TOPUP SUCCESS! (Bot V2)</b>\nOrder: ${order.orderId}\nID: ${order.playerId}\nItem: ${order.item}`, parse_mode: "HTML" };
                            if(config.tgOrderTopicId) tgPayload.message_thread_id = parseInt(config.tgOrderTopicId);
                            await axios.post(`https://api.telegram.org/bot${config.tgBotToken}/sendMessage`, tgPayload).catch(e=>{});
                        }

                    } catch (err) {
                        throw err;
                    } finally {
                        await browser.close(); // RAM မပြည့်စေရန် Browser အား မဖြစ်မနေ ပြန်ပိတ်ရမည်
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

