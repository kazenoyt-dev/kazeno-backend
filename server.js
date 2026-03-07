const admin = require('firebase-admin');
const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer'); 

const app = express();
const PORT = process.env.PORT || 3000;

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

console.log("🚀 Kazeno Backend Server (PH Persistence v7) စတင်လည်ပတ်နေပါပြီ...");

db.collection('orders').where('status', '==', 'Pending').onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
            const order = change.doc.data();
            const orderId = change.doc.id;
            let finalScreenshotUrl = ""; 

            try {
                const configDoc = await db.collection('settings').doc('app_config').get();
                const config = configDoc.data() || {};
                const smileCookie = config.cookieSmile;

                const productSnapshot = await db.collection('products').where('name', '==', order.item).limit(1).get();
                if (productSnapshot.empty) throw new Error("Product မရှိပါ။");
                const productData = productSnapshot.docs[0].data();

                if (productData.topupType === 'Auto') {
                    await db.collection('orders').doc(orderId).update({ status: 'Processing' });
                    
                    let userId = ""; let zoneId = "";
                    const match = order.playerId.match(/(\d+)\s*\(\s*(\d+)\s*\)/);
                    if (match) { userId = match[1]; zoneId = match[2]; } 
                    else { userId = order.playerId.replace(/\D/g, ''); }

                    const browser = await puppeteer.launch({
                        headless: "new",
                        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1280,800']
                    });

                    let page = await browser.newPage();
                    try {
                        await page.setViewport({ width: 1280, height: 800 }); 

                        // 💡 (၁) Cookie များကို Domain ပေါင်းစုံအတွက် သတ်မှတ်ခြင်း
                        if (!smileCookie) throw new Error("Cookie မရှိပါ။");
                        const cookieArray = smileCookie.split(';').map(pair => {
                            let [name, ...value] = pair.split('=');
                            if(!name) return null;
                            let v = value.join('=').trim();
                            return [
                                { name: name.trim(), value: v, domain: '.smile.one', path: '/' },
                                { name: name.trim(), value: v, domain: 'www.smile.one', path: '/' }
                            ];
                        }).flat().filter(c => c !== null);
                        await page.setCookie(...cookieArray);

                        // 💡 (၂) PH Server တိုက်ရိုက်လင့်ခ်သို့ အတင်းသွားမည်
                        const targetUrl = 'https://www.smile.one/ph/merchant/mobilelegends?source=other';
                        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
                        await new Promise(r => setTimeout(r, 4000));

                        // 💡 (၃) Brazil သို့ Redirect ဖြစ်သွားသလား စစ်ဆေးခြင်း
                        const currentUrl = page.url();
                        if (!currentUrl.includes('/ph/')) {
                            console.log("Redirected to non-PH page. Re-navigating...");
                            await page.goto(targetUrl, { waitUntil: 'networkidle2' });
                            await new Promise(r => setTimeout(r, 3000));
                        }

                        // Popup ပိတ်ခြင်း
                        await page.evaluate(() => {
                            document.querySelectorAll('.system_install_cancel, .close-btn, #system_install_cancel, .layui-layer-close').forEach(el => el.click());
                        });

                        // 💡 (၄) အကောင့်ဝင်မဝင် အတိအကျ စစ်ဆေးခြင်း
                        const isLoggedOut = await page.evaluate(() => {
                            return document.body.innerText.includes('Entrar') || document.body.innerText.includes('Login');
                        });

                        if (isLoggedOut) {
                            throw new Error("Login Failed: စက်ရုပ်သည် အကောင့်ထဲသို့ ဝင်ရောက်နိုင်ခြင်းမရှိပါ။");
                        }

                        // 💡 (၅) ID ထည့်ခြင်း
                        const idSelector = 'input[name="userid"]';
                        await page.waitForSelector(idSelector, { visible: true, timeout: 15000 });

                        await page.evaluate((uid, zid, pid) => {
                            const idInp = document.querySelector('input[name="userid"]');
                            const zoneInp = document.querySelector('input[name="zoneid"]');
                            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                            
                            if (idInp) { 
                                setter.call(idInp, uid); 
                                idInp.dispatchEvent(new Event('input', { bubbles: true })); 
                                idInp.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                            if (zoneInp && zid) { 
                                setter.call(zoneInp, zid); 
                                zoneInp.dispatchEvent(new Event('input', { bubbles: true }));
                                zoneInp.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                            
                            const pBox = document.querySelector(`[data-id="${pid}"]`);
                            if(pBox) pBox.click();
                        }, userId, zoneId, productData.smileId);

                        await new Promise(r => setTimeout(r, 2000));
                        await page.click('.buy-btn, #buy_btn');
                        await new Promise(r => setTimeout(r, 5000));

                        // 📸 ဓာတ်ပုံရိုက်ယူခြင်း
                        try {
                            const base64Img = await page.screenshot({ encoding: 'base64' });
                            const imgRes = await axios.post('https://api.imgbb.com/1/upload?key=f0d759dd374df91104867c6701e199f2', `image=${encodeURIComponent(base64Img)}`, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }});
                            finalScreenshotUrl = imgRes.data.data.url;
                        } catch(e) {}

                        // စာသားဖတ်ခြင်း
                        const uiMessage = await page.evaluate(() => {
                            let msg = "";
                            document.querySelectorAll('.layui-layer-content, .swal2-html-container, .error-msg').forEach(p => msg += p.innerText);
                            return msg;
                        });

                        if (uiMessage && !uiMessage.toLowerCase().includes('success') && !uiMessage.toLowerCase().includes('အောင်မြင်')) {
                            throw new Error(`Smile One: "${uiMessage}"`);
                        }

                        await db.collection('orders').doc(orderId).update({ status: 'Completed' });

                    } catch (err) {
                        // Error တက်ပါက ဓာတ်ပုံရိုက်မည်
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
                    await axios.post(`https://api.telegram.org/bot${config.tgBotToken}/sendMessage`, { chat_id: config.tgChatId, text: tgText, parse_mode: "HTML", message_thread_id: config.tgOrderTopicId ? parseInt(config.tgOrderTopicId) : undefined });
                }
            }
        }
    });
});

app.get('/', (req, res) => { res.send('✅ Kazeno Backend PH-v7 Active'); });
app.listen(PORT, () => { console.log(`Server running`); });

