const admin = require('firebase-admin');
const express = require('express');
const axios = require('axios');

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

console.log("🚀 Kazeno Backend Server (Force Inject V12) စတင်လည်ပတ်နေပါပြီ...");

db.collection('orders').where('status', '==', 'Pending').onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
            const order = change.doc.data();
            const orderId = change.doc.id;
            let finalScreenshotUrl = ""; 

            try {
                const configDoc = await db.collection('settings').doc('app_config').get();
                const config = configDoc.data() || {};
                const cookieString = config.cookieSmile; 

                if (!cookieString) throw new Error("Cookie မရှိပါ။");

                const productSnapshot = await db.collection('products').where('name', '==', order.item).limit(1).get();
                if (productSnapshot.empty) throw new Error("Product ကို Database တွင် ရှာမတွေ့ပါ။");
                const productData = productSnapshot.docs[0].data();

                if (productData.topupType === 'Auto') {
                    await db.collection('orders').doc(orderId).update({ status: 'Processing' });
                    
                    let userId = "", zoneId = "";
                    const match = order.playerId.match(/(\d+)\s*\(\s*(\d+)\s*\)/);
                    if (match) { userId = match[1]; zoneId = match[2]; } 
                    else { userId = order.playerId.replace(/\D/g, ''); }

                    console.log(`🔄 [${order.orderId}] Stealth Browser ဖွင့်နေပါသည်...`);

                    const browser = await puppeteer.launch({
                        headless: "new",
                        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1280,800']
                    });

                    let page = await browser.newPage();
                    try {
                        await page.setViewport({ width: 1280, height: 800 }); 

                        let parsedCookies = [];
                        try {
                            parsedCookies = JSON.parse(cookieString);
                        } catch(e) {
                            throw new Error("Cookie ဖော်မတ်မှားနေပါသည်။");
                        }
                        await page.setCookie(...parsedCookies);

                        await page.goto('https://www.smile.one/ph/merchant/mobilelegends', { waitUntil: 'networkidle2', timeout: 60000 });
                        
                        // 💡 စာမျက်နှာ အပြည့်တက်ရန် (၅) စက္ကန့် သေချာစောင့်မည် 💡
                        await new Promise(r => setTimeout(r, 5000));

                        const isLoggedOut = await page.evaluate(() => document.body.innerText.includes('Entrar') || document.body.innerText.includes('Login'));
                        if (isLoggedOut) throw new Error("Login Failed: Cookie သက်တမ်းကုန်နေပါသည်။");

                        await page.evaluate(() => {
                            document.querySelectorAll('.system_install_cancel, .close-btn, #system_install_cancel, .layui-layer-close').forEach(el => el.click());
                        });

                        // 💡 အမြင်အာရုံ (Selector) မစောင့်တော့ဘဲ Code ထဲမှ အတင်းရှာ၍ ထည့်ခြင်း 💡
                        await page.evaluate((uid, zid, pid) => {
                            // ID အကွက် အားလုံးကို ရှာပြီး ထည့်မည်
                            const idInputs = document.querySelectorAll('input[name="userid"], .userid');
                            const zoneInputs = document.querySelectorAll('input[name="zoneid"], .zoneid');
                            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                            
                            idInputs.forEach(inp => {
                                setter.call(inp, uid);
                                inp.dispatchEvent(new Event('input', { bubbles: true }));
                            });

                            if (zid) {
                                zoneInputs.forEach(inp => {
                                    setter.call(inp, zid);
                                    inp.dispatchEvent(new Event('input', { bubbles: true }));
                                });
                            }
                            
                            // CSV မှ Smile ID ဖြင့် Product အတိအကျကို ရွေးချယ်ခြင်း
                            const pBox = document.querySelector(`[id="${pid}"]`) || document.querySelector(`[data-id="${pid}"]`);
                            if(pBox) pBox.click();

                        }, userId, zoneId, productData.smileId);

                        await new Promise(r => setTimeout(r, 2000));
                        
                        // Buy နှိပ်ခြင်း
                        await page.evaluate(() => {
                            let buyBtn = document.querySelector('.buy-btn') || document.querySelector('#buy_btn');
                            if(buyBtn) buyBtn.click();
                        });
                        console.log(`⏳ [${order.orderId}] ဝယ်ယူရန် နှိပ်လိုက်ပါပြီ။`);
                        
                        await new Promise(r => setTimeout(r, 6000));

                        try {
                            const base64Img = await page.screenshot({ encoding: 'base64' });
                            const imgRes = await axios.post('https://api.imgbb.com/1/upload?key=f0d759dd374df91104867c6701e199f2', `image=${encodeURIComponent(base64Img)}`, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }});
                            finalScreenshotUrl = imgRes.data.data.url;
                        } catch(e) {}

                        const uiMessage = await page.evaluate(() => {
                            let msg = "";
                            document.querySelectorAll('.layui-layer-content, .swal2-html-container, .error-msg').forEach(p => msg += p.innerText);
                            return msg;
                        });

                        if (uiMessage && !uiMessage.toLowerCase().includes('success') && !uiMessage.toLowerCase().includes('အောင်မြင်')) {
                            throw new Error(`Smile One: "${uiMessage}"`);
                        }

                        await db.collection('orders').doc(orderId).update({ status: 'Completed' });
                        console.log(`✅ [${order.orderId}] အောင်မြင်စွာ ဖြည့်သွင်းပြီးပါပြီ!`);
                        
                        if(config.tgBotToken && config.tgChatId) {
                            let tgText = `✅ <b>AUTO-TOPUP SUCCESS!</b>\nOrder: ${order.orderId}\nID: ${order.playerId}\nItem: ${order.item}`;
                            if(finalScreenshotUrl) tgText += `\n📸 <a href="${finalScreenshotUrl}">အောင်မြင်သည့်ပုံ ကြည့်ရန်</a>`;
                            await axios.post(`https://api.telegram.org/bot${config.tgBotToken}/sendMessage`, { chat_id: config.tgChatId, text: tgText, parse_mode: "HTML", message_thread_id: config.tgOrderTopicId ? parseInt(config.tgOrderTopicId) : undefined }).catch(e=>{});
                        }

                    } catch (err) {
                        if (page && !finalScreenshotUrl) {
                            try {
                                const base64Img = await page.screenshot({ encoding: 'base64' });
                                const imgRes = await axios.post('https://api.imgbb.com/1/upload?key=f0d759dd374df91104867c6701e199f2', `image=${encodeURIComponent(base64Img)}`, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }});
                                finalScreenshotUrl = imgRes.data.data.url;
                            } catch(e) {}
                        }
                        throw err; 
                    } finally {
                        await browser.close(); 
                    }
                }
            } catch (error) {
                console.log(`❌ Fail: ${error.message}`);
                const configDoc = await db.collection('settings').doc('app_config').get();
                const config = configDoc.data() || {};
                if(config.tgBotToken && config.tgChatId) {
                    let tgText = `⚠️ <b>AUTO-TOPUP FAILED</b> ⚠️\nOrder: ${order.orderId}\nReason: ${error.message}`;
                    if(finalScreenshotUrl) tgText += `\n\n📸 <a href="${finalScreenshotUrl}">စက်ရုပ်မြင်နေရသည့်ပုံ</a>`;
                    await axios.post(`https://api.telegram.org/bot${config.tgBotToken}/sendMessage`, { chat_id: config.tgChatId, text: tgText, parse_mode: "HTML", message_thread_id: config.tgOrderTopicId ? parseInt(config.tgOrderTopicId) : undefined }).catch(e=>{});
                }
            }
        }
    });
});

app.get('/', (req, res) => { res.send('✅ Kazeno Backend Final V12 Active'); });
app.listen(PORT, () => { console.log(`Server running`); });

