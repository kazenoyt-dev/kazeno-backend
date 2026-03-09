const admin = require('firebase-admin');
const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Firebase ချိတ်ဆက်ခြင်း (Environment Variable မှ သို့မဟုတ် JSON ဖိုင်မှ)
let serviceAccount;
if (fs.existsSync('./firebase.json')) {
    serviceAccount = require('./firebase.json');
} else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
    console.error("❌ Firebase Service Account ရှာမတွေ့ပါ။");
}

if (serviceAccount) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    const db = admin.firestore();

    console.log("🚀 Kazeno Backend Server (Semi-Auto Master) စတင်လည်ပတ်နေပါပြီ...");

    // Orders များကို Real-time စောင့်ကြည့်ခြင်း
    db.collection('orders').where('status', '==', 'Pending').onSnapshot(snapshot => {
        snapshot.docChanges().forEach(async (change) => {
            if (change.type === 'added') {
                const order = change.doc.data();
                const orderId = change.doc.id;

                try {
                    // Customer အား 'Processing' ဖြစ်ကြောင်း ပြသရန် Status ကို ချက်ချင်းပြောင်းမည်
                    await db.collection('orders').doc(orderId).update({ status: 'Processing' });
                    console.log(`📦 [${orderId}] အော်ဒါအသစ် ဝင်လာပါပြီ။ Telegram သို့ ပို့နေပါသည်...`);

                    const configDoc = await db.collection('settings').doc('app_config').get();
                    const config = configDoc.data() || {};

                    // Telegram သို့ အော်ဒါအချက်အလက်များ လှလှပပ ပို့ဆောင်ခြင်း
                    if (config.tgBotToken && config.tgChatId) {
                        let tgText = `🚨 <b>NEW ORDER [PROCESSING]</b> 🚨\n━━━━━━━━━━━━━━\n`;
                        tgText += `<b>Order ID:</b> ${order.orderId || orderId}\n`;
                        tgText += `<b>Game:</b> ${order.game || 'Unknown'}\n`;
                        tgText += `<b>Item:</b> ${order.item}\n`;
                        tgText += `<b>Price:</b> ${(order.price || 0).toLocaleString()} Ks\n`;
                        tgText += `<b>Payment:</b> ${order.payMethod || 'Wallet'}\n\n`;
                        
                        // 💡 `code` tag သုံးထားသဖြင့် Admin မှ Player ID ကို တစ်ချက်နှိပ်ရုံဖြင့် Copy ကူးနိုင်မည် 💡
                        let cleanId = order.playerId ? order.playerId.split(' ')[0] : '';
                        tgText += `<b>Player ID:</b> <code>${cleanId}</code>\n`;
                        tgText += `<b>Full Acc Info:</b> ${order.playerId}\n\n`; 
                        
                        tgText += `📌 <i>Smile One တွင် ဖြည့်သွင်းပြီးပါက Admin Panel တွင် 'Complete' လုပ်ပေးပါ။</i>`;

                        let payload = {
                            chat_id: config.tgChatId,
                            text: tgText,
                            parse_mode: "HTML",
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: "🌐 Open Smile.one (MLBB)", url: "https://www.smile.one/ph/merchant/mobilelegends" }]
                                ]
                            }
                        };

                        if (config.tgOrderTopicId) {
                            payload.message_thread_id = parseInt(config.tgOrderTopicId);
                        }

                        // Slip ပုံ ပါလာပါက ပုံနှင့်တကွ ပို့မည်
                        if (order.slipImage) {
                            payload.photo = order.slipImage;
                            payload.caption = tgText;
                            delete payload.text;
                            await axios.post(`https://api.telegram.org/bot${config.tgBotToken}/sendPhoto`, payload).catch(e=>console.log("TG Photo Error:", e.message));
                        } else {
                            await axios.post(`https://api.telegram.org/bot${config.tgBotToken}/sendMessage`, payload).catch(e=>console.log("TG Msg Error:", e.message));
                        }
                        
                        console.log(`✅ [${orderId}] Telegram သို့ အောင်မြင်စွာ ပို့ဆောင်ပြီးပါပြီ။`);
                    }

                } catch (error) {
                    console.log(`❌ Fail processing order ${orderId}: ${error.message}`);
                }
            }
        });
    });

}

app.get('/', (req, res) => { res.send('✅ Kazeno Backend (Semi-Auto) is Active!'); });
app.listen(PORT, () => { console.log(`Server is running on port ${PORT}`); });
