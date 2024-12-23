const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const colors = require('colors');

const express = require('express');
const session = require('express-session');
const crypto = require('crypto');

const { validateKeyAndVersion } = require('./checkKey')
require('dotenv').config()


// Bot and Google OAuth2 Configuration
const token = process.env.TELEGRAM_BOT_TOKEN;

// Initialize Express app and Telegram bot
const app = express();
const bot = new TelegramBot(token, { polling: true });

// Session middleware
app.use(
    session({
        secret: crypto.randomBytes(32).toString('hex'),
        resave: false,
        saveUninitialized: true,
    })
);


// Store search results and current page for each user
const userSearchResults = {};
const userCurrentPage = {};

// Handle /start command
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const welcomeMessage = `
*Chào mừng đến với TicketBot!*

Bạn có thể sử dụng các lệnh sau để tương tác với bot:
- \`/key\`: Nhận key máy của bạn và kích hoạt.
- \`/search <từ khóa>\`: Tìm kiếm sự kiện theo từ khóa.

*Ví dụ:*
\`/search concert\`

Nếu bạn cần hỗ trợ, vui lòng liên hệ [@hd_onus](https://t.me/hd_onus).
    `;
    await bot.sendMessage(chatId, welcomeMessage, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
    });

    // Automatically run /key command
    bot.emit('text', { chat: { id: chatId }, text: '/key' });
});



// Handle /key command
// Update /key command
bot.onText(/\/key/, async (msg) => {
    const chatId = msg.chat.id;
    const isValid = await validateKeyAndVersion(chatId);

    if (isValid) {
        await bot.sendMessage(chatId, 'Key đã được kích hoạt!', {
            parse_mode: 'Markdown',
        });
    }
});
// Hàm xử lý dữ liệu
const extractEventInfo = (data) => {
    // console.log( data.data.results)
    const results = data.data.results.map((event) => {
        // console.log("results",event.badge.label.vi)
        return {
            id: event.originalId,
            name: event.name,
            day: new Date(event.day).toLocaleString("vi-VN"), // Format ngày giờ
            price: event.price.toLocaleString("vi-VN") + " VND", // Format giá
            deeplink: event.deeplink
            // badge: event.badge.label // Trích badge tiếng Việt
        };
    });
    return results;
};


// Handle /search command
bot.onText(/^\/search (.+)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const query = match[1];

    if (!query?.trim()) {
        return bot.sendMessage(chatId, 'Vui lòng nhập từ khóa tìm kiếm hợp lệ.', {
            parse_mode: 'Markdown',
        });
    }

    const isValid = await validateKeyAndVersion(chatId);
    if (!isValid) return;

    // Rest of your search logic
    try {
        const response = await axios.get(
            `https://api-v2.ticketbox.vn/search/v2/events?limit=40&page=1&q=${encodeURIComponent(query)}`
        );

        // Trích xuất thông tin
        const events = extractEventInfo(response.data);
        console.log("events", events.length);

        if (events.length > 0) {
            userSearchResults[chatId] = events;
            userCurrentPage[chatId] = 0;
            const messageId = await sendEventPage(chatId, 0);
            userSearchResults[chatId].messageId = messageId;
        } else {
            await bot.sendMessage(chatId, 'Không tìm thấy sự kiện nào phù hợp.', {
                parse_mode: 'Markdown',
            });
        }
    } catch (error) {
        console.error('Search API error:', error);
        await bot.sendMessage(chatId, 'Đã xảy ra lỗi trong quá trình tìm kiếm.', {
            parse_mode: 'Markdown',
        });
    }
});

// Handle the case when no query is provided after "/search"
bot.onText(/^\/search$/, async (msg) => {
    const chatId = msg.chat.id;

    const isValid = await validateKeyAndVersion(chatId);
    if (!isValid) return;

    await bot.sendMessage(chatId, 'Vui lòng nhập từ khóa tìm kiếm sau lệnh /search. Ví dụ: /search concert');
});

// Function to send event page
const sendEventPage = async (chatId, page, messageId) => {
    const events = userSearchResults[chatId];
    const event = events[page];
    const totalPages = events.length;

    const text = `*ID:* ${event.id}\n*Tên sự kiện:* ${event.name}\n*Ngày:* ${event.day}\n*Giá vé:* ${event.price}\n*Thông tin thêm:* [Link](${event.deeplink})`;

    const options = {
        parse_mode: "Markdown",
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '⬅️', callback_data: 'prev' },
                    { text: `${page + 1}/${totalPages}`, callback_data: 'noop' },
                    { text: '➡️', callback_data: 'next' }
                ]
            ]
        }
    };

    if (messageId) {
        await bot.editMessageText(text, { ...options, chat_id: chatId, message_id: messageId });
    } else {
        const sentMessage = await bot.sendMessage(chatId, text, options);
        return sentMessage.message_id;
    }
};

// Handle callback queries for pagination
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    const messageId = callbackQuery.message.message_id;

    if (data === 'prev') {
        if (userCurrentPage[chatId] > 0) {
            userCurrentPage[chatId]--;
            await sendEventPage(chatId, userCurrentPage[chatId], messageId);
        }
    } else if (data === 'next') {
        if (userCurrentPage[chatId] < userSearchResults[chatId].length - 1) {
            userCurrentPage[chatId]++;
            await sendEventPage(chatId, userCurrentPage[chatId], messageId);
        }
    }

    // Acknowledge the callback query
    await bot.answerCallbackQuery(callbackQuery.id);
});

// Start express server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Error handling for bot
bot.on('error', (error) => {
    console.error('Telegram Bot Error:', error.message);
});

console.log('Bot is running...');
