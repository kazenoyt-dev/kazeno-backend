const admin = require('firebase-admin');
const express = require('express');
const axios = require('axios');
const qs = require('qs');

const app = express();
const PORT = process.env.PORT || 3000;

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

console.log("🚀 Kazeno Professional API Server စတင်လည်ပတ်နေပါပြီ...");

db.collection('orders').where('status', '==', 'Pending').onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
            const order = change.doc.data();
            const orderId = change.doc.id;

            try {
                const configDoc = await db.collection('settings').doc('app_config').get();
                const config = configDoc.data() || {};
                const smileCookie = config.cookieSmile;

                const productSnapshot = await db.collection('products').where('name', '==', order.item).limit(1).get();
                if (productSnapshot.empty) throw new Error("Product ID မတွေ့ပါ။");
                const productData = productSnapshot.docs[0].data();

                if (productData.topupType === 'Auto') {
                    await db.collection('orders').doc(orderId).update({ status: 'Processing' });
                    
                    // ID နှင့် Zone ခွဲထုတ်ခြင်း
                    let userId = "", zoneId = "";
                    const match = order.playerId.match(/(\d+)\s*\(\s*(\d+)\s*\)/);
                    if (match) { userId = match[1]; zoneId = match[2]; } 
                    else { userId = order.playerId.replace(/\D/g, ''); }

                    console.log(`📡 [${order.orderId}] အတွက် Smile One သို့ တိုက်ရိုက် စာပို့နေပါသည်...`);

                    // 💡 Professional Direct Request စနစ် 💡
                    const response = await axios({
                        method: 'post',
                        url: 'https://www.smile.one/smilecoin/api/createorder',
                        headers: {
                            'Cookie': smileCookie,
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                        },
                        data: qs.stringify({
                            userid: userId,
                            zoneid: zoneId,
                            productid: productData.smileId,
                            payway: 'smilecoin' // သင့်အကောင့်ထဲက Smile Coin ကို သုံးရန်
                        })
                    });

                    // Smile One မှ ပြန်လာသော အဖြေကို စစ်ဆေးခြင်း
                    const resData = response.data;
                    if (resData.code === 200 || resData.status === 200 || resData.message === 'success') {
                        await db.collection('orders').doc(orderId).update({ status: 'Completed' });
                        console.log(`✅ [${order.orderId}] အောင်မြင်စွာ ဖြည့်သွင်းပြီးပါပြီ!`);
                        
                        // Telegram Alert
                        await axios.post(`https://api.telegram.org/bot${config.tgBotToken}/sendMessage`, {
                            chat_id: config.tgChatId,
                            text: `✅ <b>AUTO-TOPUP SUCCESS!</b>\nOrder: ${order.orderId}\nID: ${order.playerId}\nItem: ${order.item}`,
                            parse_mode: "HTML",
                            message_thread_id: config.tgOrderTopicId ? parseInt(config.tgOrderTopicId) : undefined
                        }).catch(e=>{});

                    } else {
                        throw new Error(resData.msg || resData.message || "Smile One မှ ငြင်းပယ်လိုက်ပါသည်။");
                    }
                }
            } catch (error) {
                console.log(`❌ Error: ${error.message}`);
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

app.get('/', (req, res) => { res.send('✅ Kazeno Direct API Backend is Running!'); });
app.listen(PORT, () => { console.log(`Server started on port ${PORT}`); });

