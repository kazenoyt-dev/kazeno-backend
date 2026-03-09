const admin = require('firebase-admin');
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Firebase ချိတ်ဆက်ခြင်း
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

console.log("🚀 Kazeno Backend Server (Semi-Auto Master Version) စတင်လည်ပတ်နေပါပြီ...");

// Orders များကို စောင့်ကြည့်ခြင်း
db.collection('orders').where('status', '==', 'Pending').onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
            const order = change.doc.data();
            const orderId = change.doc.id;

            try {
                // Customer ထံသို့ 'Processing' အဖြစ် ပြသရန် Status ပြောင်းပေးခြင်း
                await db.collection('orders').doc(orderId).update({ status: 'Processing' });
                console.log(`📦 [${orderId}] အော်ဒါအသစ် ဝင်လာပါပြီ။ Telegram သို့ ပို့နေပါသည်...`);

                const configDoc = await db.collection('settings').doc('app_config').get();
                const config = configDoc.data() || {};

                if (config.tgBotToken && config.tgChatId) {
                    // Telegram သို့ ပို့မည့် စာသား (HTML Format ဖြင့် လှပအောင် ပြင်ဆင်ထားသည်)
                    let tgText = `🚨 <b>NEW ORDER RECEIVED</b> 🚨\n\n`;
                    tgText += `<b>Order ID:</b> ${orderId}\n`;
                    tgText += `<b>Item:</b> ${order.item}\n`;
                    tgText += `<b>Payment:</b> ${order.paymentMethod || 'N/A'}\n`;
                    
                    // 💡 `code` tag သုံးထားသဖြင့် Admin မှ တစ်ချက်နှိပ်ရုံဖြင့် Copy ကူးနိုင်မည် 💡
                    tgText += `<b>Player ID:</b> <code>${order.playerId}</code>\n\n`; 
                    
                    tgText += `📌 <i>Smile One တွင် Manual ဖြည့်သွင်းပြီးပါက Admin Panel တွင် 'Completed' လုပ်ပေးပါ။</i>`;

                    await axios.post(`https://api.telegram.org/bot${config.tgBotToken}/sendMessage`, {
                        chat_id: config.tgChatId,
                        text: tgText,
                        parse_mode: "HTML",
                        message_thread_id: config.tgOrderTopicId ? parseInt(config.tgOrderTopicId) : undefined,
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "🌐 Smile One သို့ သွားရန်", url: "https://www.smile.one/ph/merchant/mobilelegends" }]
                            ]
                        }
                    });
                    
                    console.log(`✅ [${orderId}] Telegram သို့ အောင်မြင်စွာ ပို့ဆောင်ပြီးပါပြီ။`);
                }

            } catch (error) {
                console.log(`❌ Fail: ${error.message}`);
            }
        }
    });
});

app.get('/', (req, res) => { res.send('✅ Kazeno Backend (Semi-Auto) Active'); });
app.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });

