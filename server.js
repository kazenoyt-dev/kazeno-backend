const admin = require('firebase-admin');
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

console.log("🚀 Kazeno Backend Server စတင်လည်ပတ်နေပါပြီ...");

// အော်ဒါအသစ်ဝင်လာတိုင်း အလိုအလျောက် သိရှိမည့်စနစ်
db.collection('orders').where('status', '==', 'Pending').onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
            const order = change.doc.data();
            const orderId = change.doc.id;

            console.log(`📦 အော်ဒါအသစ် ဝင်လာပါပြီ: [${order.orderId}] - Product: ${order.item}`);

            try {
                // Admin Panel ထဲက Settings ကို လှမ်းယူခြင်း
                const configDoc = await db.collection('settings').doc('app_config').get();
                const config = configDoc.data() || {};
                const smileCookie = config.cookieSmile;
                const tgBotToken = config.tgBotToken;
                const tgChatId = config.tgChatId;
                const tgOrderTopicId = config.tgOrderTopicId;

                // Product ရဲ့ Smile ID ကို Database ထဲကနေ ရှာခြင်း
                const productSnapshot = await db.collection('products').where('name', '==', order.item).limit(1).get();
                if (productSnapshot.empty) {
                    throw new Error("Product အချက်အလက်ကို Database တွင် ရှာမတွေ့ပါ။");
                }
                const productData = productSnapshot.docs[0].data();
                
                // ⚠️ Product Type က "Auto" ဖြစ်မှသာ အလုပ်လုပ်မည်
                if (productData.topupType === 'Auto') {
                    
                    if (!smileCookie || smileCookie.length < 10) {
                        throw new Error("Admin Panel တွင် Smile One Cookie ထည့်သွင်းထားခြင်း မရှိပါ။");
                    }
                    if (!productData.smileId) {
                        throw new Error("ဤ Product အတွက် 'Smile ID' ထည့်သွင်းထားခြင်း မရှိပါ။");
                    }

                    // ၁။ အော်ဒါကို Processing ပြောင်းပါမယ်
                    await db.collection('orders').doc(orderId).update({ status: 'Processing' });
                    console.log(`🔄 [${order.orderId}] ကို Processing သို့ ပြောင်းလိုက်ပါပြီ။ Smile One သို့ ချိတ်ဆက်နေပါသည်...`);

                    // ၂။ Player ID နှင့် Zone ID ကို ခွဲထုတ်ခြင်း (ဥပမာ- "12345678 (1234)" မှ)
                    let userId = "";
                    let zoneId = "";
                    const match = order.playerId.match(/(\d+)\s*\(\s*(\d+)\s*\)/);
                    if (match) {
                        userId = match[1];
                        zoneId = match[2];
                    } else {
                        userId = order.playerId.replace(/\D/g, ''); // ဂဏန်းများသာ ယူမည်
                    }

                    // ၃။ Smile One သို့ API Request လှမ်းပို့ခြင်း
                    const payload = new URLSearchParams({
                        userid: userId,
                        zoneid: zoneId,
                        productid: productData.smileId
                    });

                    const response = await axios.post('https://www.smile.one/smilecoin/api/createorder', payload.toString(), {
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'Cookie': smileCookie,
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Origin': 'https://www.smile.one',
                            'Referer': 'https://www.smile.one/'
                        }
                    });

                    // ၄။ Smile One မှ အောင်မြင်ကြောင်း ပြန်လာပါက
                    if (response.data && (response.data.code === 200 || response.data.status === 'success' || response.data.message === 'success')) {
                        await db.collection('orders').doc(orderId).update({ status: 'Completed' });
                        console.log(`✅ [${order.orderId}] ကို Smile One မှ အောင်မြင်စွာ ဖြည့်သွင်းပြီးပါပြီ!`);
                        
                        // Telegram သို့ အောင်မြင်ကြောင်း ပို့ပေးမည်
                        if(tgBotToken && tgChatId) {
                            let endPoint = `https://api.telegram.org/bot${tgBotToken}/sendMessage`;
                            let tgPayload = { chat_id: tgChatId, text: `✅ <b>AUTO-TOPUP SUCCESS!</b>\nOrder: ${order.orderId}\nGame ID: ${order.playerId}\nItem: ${order.item}`, parse_mode: "HTML" };
                            if(tgOrderTopicId) tgPayload.message_thread_id = parseInt(tgOrderTopicId);
                            await axios.post(endPoint, tgPayload).catch(e=>{});
                        }
                    } else {
                        throw new Error(response.data.message || JSON.stringify(response.data));
                    }

                } else {
                    console.log(`ℹ️ ဤအော်ဒါသည် Manual ဖြစ်သဖြင့် Auto Topup မလုပ်ပါ။`);
                }

            } catch (error) {
                console.log(`❌ Auto-Topup ကျရှုံးပါသည်: ${error.message}`);
                
                // Error တက်ပါက အော်ဒါကို Cancelled မလုပ်ဘဲ Processing အနေအထားတွင်သာ ထားမည် (Admin မှ Manual ဖြည့်နိုင်ရန်)
                // Telegram သို့ Error ပို့ပေးမည်
                const configDoc = await db.collection('settings').doc('app_config').get();
                const config = configDoc.data() || {};
                if(config.tgBotToken && config.tgChatId) {
                    let endPoint = `https://api.telegram.org/bot${config.tgBotToken}/sendMessage`;
                    let tgPayload = { chat_id: config.tgChatId, text: `⚠️ <b>AUTO-TOPUP FAILED</b> ⚠️\nOrder: ${order.orderId}\nReason: ${error.message}\nကျေးဇူးပြု၍ Admin မှ Manual သွားဖြည့်ပေးပါ။`, parse_mode: "HTML" };
                    if(config.tgOrderTopicId) tgPayload.message_thread_id = parseInt(config.tgOrderTopicId);
                    await axios.post(endPoint, tgPayload).catch(e=>{});
                }
            }
        }
    });
});

app.get('/', (req, res) => {
    res.send('✅ Kazeno Auto Topup Backend is Active and Running 24/7!');
});

app.listen(PORT, () => {
    console.log(`🌐 Web Server သည် Port ${PORT} တွင် အလုပ်လုပ်နေပါသည်။`);
});
