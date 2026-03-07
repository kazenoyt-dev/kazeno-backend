const admin = require('firebase-admin');
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Firebase ကို လုံခြုံစွာ ချိတ်ဆက်ခြင်း (Secret Key မှတဆင့်)
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

            console.log(`📦 အော်ဒါအသစ် ဝင်လာပါပြီ: [${order.orderId}]`);

            // Admin Panel ထဲက Settings ကို လှမ်းယူခြင်း
            const configDoc = await db.collection('settings').doc('app_config').get();
            const config = configDoc.data();
            const smileCookie = config.cookieSmile;
            const tgBotToken = config.tgBotToken;
            const tgChatId = config.tgChatId;

            // ⚠️ ဒီနေရာမှာ Auto လို့ သတ်မှတ်ထားတဲ့ Product ဖြစ်မှသာ Smile One ကို လှမ်းချိတ်ပါမယ်
            if (smileCookie && smileCookie.length > 10) {
                
                // ၁။ အော်ဒါကို Processing ပြောင်းပါမယ်
                await db.collection('orders').doc(orderId).update({ status: 'Processing' });
                console.log(`🔄 [${order.orderId}] ကို Processing သို့ ပြောင်းလိုက်ပါပြီ။ Smile One သို့ ချိတ်ဆက်နေပါသည်...`);

                try {
                    /* ========================================================
                       💡 ဤနေရာသည် Smile One သို့ တိုက်ရိုက်ချိတ်ဆက်မည့် နေရာဖြစ်သည် 💡
                       (Smile One ၏ အတိအကျ API ပုံစံပေါ်မူတည်၍ ဤအပိုင်းကို အချောသတ်ရပါမည်)
                       ======================================================== */
                    
                    // ဥပမာ - Smile One သို့ Request ပို့ခြင်း (Mock API structure)
                    // const response = await axios.post('https://www.smile.one/api/topup', {
                    //    playerId: order.playerId,
                    //    productName: order.item
                    // }, {
                    //    headers: { 'Cookie': smileCookie }
                    // });

                    // အောင်မြင်သွားပါက Completed ပြောင်းပါမည်
                    // await db.collection('orders').doc(orderId).update({ status: 'Completed' });
                    // console.log(`✅ [${order.orderId}] ကို Smile One မှ အောင်မြင်စွာ ဖြည့်သွင်းပြီးပါပြီ!`);

                } catch (error) {
                    console.log(`❌ Smile One ချိတ်ဆက်မှု ကျရှုံးပါသည်: ${error.message}`);
                    // Telegram သို့ Error ပို့ပေးမည်
                    if(tgBotToken && tgChatId) {
                        const errText = encodeURIComponent(`⚠️ <b>AUTO-TOPUP FAILED</b> ⚠️\nOrder: ${order.orderId}\nReason: ${error.message}\nကျေးဇူးပြု၍ Admin မှ Manual သွားဖြည့်ပေးပါ။`);
                        await axios.get(`https://api.telegram.org/bot${tgBotToken}/sendMessage?chat_id=${tgChatId}&text=${errText}&parse_mode=HTML`);
                    }
                }
            } else {
                console.log(`⚠️ Smile One Cookie မရှိသေးပါ။ Auto Topup အလုပ်မလုပ်ပါ။`);
            }
        }
    });
});

// Server အသက်ဝင်နေကြောင်း ပြသရန် URL
app.get('/', (req, res) => {
    res.send('✅ Kazeno Auto Topup Backend is Active and Running 24/7!');
});

app.listen(PORT, () => {
    console.log(`🌐 Web Server သည် Port ${PORT} တွင် အလုပ်လုပ်နေပါသည်။`);
});

