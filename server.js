const admin = require('firebase-admin');
const express = require('express');
const axios = require('axios');
const qs = require('qs');

const app = express();
const PORT = process.env.PORT || 3000;

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

console.log("🚀 Kazeno Backend Server (Direct 2-Step API V9) စတင်လည်ပတ်နေပါပြီ...");

db.collection('orders').where('status', '==', 'Pending').onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
            const order = change.doc.data();
            const orderId = change.doc.id;

            try {
                const configDoc = await db.collection('settings').doc('app_config').get();
                const config = configDoc.data() || {};
                const smileCookie = config.cookieSmile;

                if (!smileCookie) throw new Error("Cookie ထည့်သွင်းထားခြင်း မရှိပါ။");

                const productSnapshot = await db.collection('products').where('name', '==', order.item).limit(1).get();
                if (productSnapshot.empty) throw new Error("Product အချက်အလက် ရှာမတွေ့ပါ။");
                const productData = productSnapshot.docs[0].data();

                if (productData.topupType === 'Auto') {
                    await db.collection('orders').doc(orderId).update({ status: 'Processing' });
                    
                    let userId = "", zoneId = "";
                    const match = order.playerId.match(/(\d+)\s*\(\s*(\d+)\s*\)/);
                    if (match) { userId = match[1]; zoneId = match[2]; } 
                    else { userId = order.playerId.replace(/\D/g, ''); }

                    console.log(`📡 [${order.orderId}] Step 1: ဝဘ်ဆိုက်မှ Sign ကုဒ်ကို ရယူနေပါသည်...`);
                    
                    const headers = {
                        'Cookie': smileCookie,
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9'
                    };

                    // 💡 Step 1: HTML ကို လှမ်းယူပြီး Sign ကို ရှာဖွေခြင်း 💡
                    const getRes = await axios.get('https://www.smile.one/ph/merchant/mobilelegends', { headers });
                    const html = getRes.data;

                    if (html.includes('Entrar') || html.includes('Login') || html.includes('sign in')) {
                        throw new Error("Cookie သက်တမ်းကုန်နေပါသည် သို့မဟုတ် မှားယွင်းနေပါသည်။ (Login ဝင်ရန် တောင်းဆိုနေပါသည်)");
                    }

                    // HTML ထဲမှ sign ကုဒ်ကို ရှာဖွေခြင်း (Regex)
                    let sign = "";
                    const signMatch = html.match(/sign\s*:\s*['"]([^'"]+)['"]/i) || html.match(/name="sign"\s+value="([^"]+)"/i);
                    if (signMatch && signMatch[1]) {
                        sign = signMatch[1];
                        console.log(`🔑 Sign ကုဒ် ရရှိပါပြီ: ${sign.substring(0, 5)}...`);
                    } else {
                        throw new Error("Smile One ဝဘ်ဆိုက်မှ Sign ကုဒ်ကို ရှာမတွေ့ပါ။");
                    }

                    console.log(`📡 [${order.orderId}] Step 2: တိုက်ရိုက် ဝယ်ယူနေပါသည်...`);

                    // 💡 Step 2: Sign နှင့် Cookie ကို သုံး၍ ဝယ်ယူရန် စာလှမ်းပို့ခြင်း 💡
                    const payload = qs.stringify({
                        userid: userId,
                        zoneid: zoneId,
                        productid: productData.smileId,
                        payway: 'smilecoin',
                        sign: sign // ရှာတွေ့ထားသော ကုဒ်အသစ်ကို ထည့်သွင်းခြင်း
                    });

                    const postRes = await axios.post('https://www.smile.one/smilecoin/api/createorder', payload, {
                        headers: {
                            ...headers,
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'Origin': 'https://www.smile.one',
                            'Referer': 'https://www.smile.one/ph/merchant/mobilelegends'
                        }
                    });

                    const resData = postRes.data;
                    
                    if (resData.code === 200 || resData.status === 200 || resData.message === 'success') {
                        await db.collection('orders').doc(orderId).update({ status: 'Completed' });
                        console.log(`✅ [${order.orderId}] အောင်မြင်စွာ ဖြည့်သွင်းပြီးပါပြီ!`);
                        
                        if(config.tgBotToken && config.tgChatId) {
                            await axios.post(`https://api.telegram.org/bot${config.tgBotToken}/sendMessage`, {
                                chat_id: config.tgChatId,
                                text: `✅ <b>AUTO-TOPUP SUCCESS! (API V9)</b>\nOrder: ${order.orderId}\nID: ${order.playerId}\nItem: ${order.item}`,
                                parse_mode: "HTML",
                                message_thread_id: config.tgOrderTopicId ? parseInt(config.tgOrderTopicId) : undefined
                            }).catch(e=>{});
                        }
                    } else {
                        throw new Error(resData.msg || resData.message || JSON.stringify(resData));
                    }
                }
            } catch (error) {
                console.log(`❌ Fail: ${error.message}`);
                const configDoc = await db.collection('settings').doc('app_config').get();
                const config = configDoc.data() || {};
                if(config.tgBotToken && config.tgChatId) {
                    await axios.post(`https://api.telegram.org/bot${config.tgBotToken}/sendMessage`, {
                        chat_id: config.tgChatId,
                        text: `⚠️ <b>AUTO-TOPUP FAILED</b> ⚠️\nOrder: ${order.orderId}\nReason: ${error.message}`,
                        parse_mode: "HTML",
                        message_thread_id: config.tgOrderTopicId ? parseInt(config.tgOrderTopicId) : undefined
                    }).catch(e=>{});
                }
            }
        }
    });
});

app.get('/', (req, res) => { res.send('✅ Kazeno Backend API V9 Active'); });
app.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });
