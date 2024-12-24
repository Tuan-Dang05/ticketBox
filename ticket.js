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
- \`/search từ khóa\`: Tìm kiếm sự kiện theo từ khóa.
- \`/pick ID\`: Xem thông tin sự kiện theo ID.
- \`/config email|fullname|phoneNumber\`: Thêm thông tin nhận vé.

*Ví dụ:*
\`/search concert\`
\`/pick 12345\`
\`/config example@gmail.com "Nguyễn Văn A" 0981234567\`

Nếu bạn cần hỗ trợ, vui lòng liên hệ [@hd_onus](https://t.me/hd_onus).
    `;
    await bot.sendMessage(chatId, welcomeMessage, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Nhận key', callback_data: 'key' }],
                [{ text: 'Tìm kiếm sự kiện', callback_data: 'search' }],
                [{ text: 'Xem thông tin sự kiện', callback_data: 'pick' }],
                [{ text: 'Thêm thông tin nhận vé', callback_data: 'config' }]
            ]
        }
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
    const results = data.data.results.map((event) => {
        const badge = event.badge && event.badge.label ? event.badge.label.vi : 'Mua vé ngay';
        return {
            id: event.originalId,
            name: event.name,
            day: new Date(event.day).toLocaleString("vi-VN"), // Format ngày giờ
            price: event.price.toLocaleString("vi-VN") + " VND", // Format giá
            deeplink: event.deeplink,
            badge: badge,
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


// Handle /pick command
bot.onText(/^\/pick (\d+)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const eventId = match[1];

    if (!eventId.trim() || isNaN(eventId)) {
        return bot.sendMessage(chatId, 'Vui lòng nhập ID sự kiện hợp lệ.', {
            parse_mode: 'Markdown',
        });
    }

    const isValid = await validateKeyAndVersion(chatId);
    if (!isValid) return;

    try {
        const response = await axios.get(
            `https://api-v2.ticketbox.vn/gin/api/v1/events/${eventId}`
        );

        const event = response.data.data.result;
        const statusEvent = event.statusName === 'Select showtime' ? 'Đang diễn ra' : 'Đã kết thúc';

        // Function to format date and time
        const formatDateTime = (startTime, endTime) => {
            const start = new Date(startTime);
            const end = new Date(endTime);

            const formatTime = (date) => {
                return date.toLocaleTimeString('vi-VN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                });
            };

            const formatDate = (date) => {
                return date.toLocaleDateString('vi-VN', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric'
                });
            };

            return `${formatTime(start)} - ${formatTime(end)} ${formatDate(start)}`;
        };

        console.log(event.statusName)
        // First message with event info and photo
        const eventInfo = `*ID:* \`${event.id}\`
*Tên sự kiện:* ${event.title}
*Địa chỉ:* ${event.address}
*Trạng thái:* ${statusEvent}


${event.statusName === 'Select showtime' || event.statusName === 'Book now' ? "Mua vé ngay" : "Suất diễn đã kết thúc"}`;

        // Send photo with basic event info
        await bot.sendPhoto(chatId, event.bannerURL, {
            caption: eventInfo,
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
        });

        // Send ticket information in separate messages for each showing
        for (const showing of event.showings) {
            const showingDateTime = formatDateTime(showing.startTime, showing.endTime);
            let ticketMessage = `📅 *${showingDateTime}*\n`;

            for (const ticket of showing.ticketTypes) {
                ticketMessage += `
                🆔 \`${ticket.id}\`
                🎟 ${ticket.name}
                💵 ${ticket.price.toLocaleString("vi-VN")} VND
                _${ticket.description}_  
                *Trạng thái:* ${ticket.statusName === 'Book now' ? 'Còn vé' : 'Hết vé'}
`;
            }

            await bot.sendMessage(chatId, ticketMessage, {
                parse_mode: 'Markdown'
            });
        }
    } catch (error) {
        console.error('Pick API error:', error);
        await bot.sendMessage(chatId, 'Đã xảy ra lỗi khi lấy thông tin sự kiện.', {
            parse_mode: 'Markdown',
        });
    }
});



bot.onText(/^\/config (.+) (.+) (.+)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const email = match[1];
    const fullName = match[2];  // Lấy nội dung trong dấu ngoặc kép
    let phoneNumber = match[3];

    // // Format phone number to +84
    // if (phoneNumber.startsWith('0')) {
    //     phoneNumber = '+84' + phoneNumber.slice(1);
    // }

    const isValid = await validateKeyAndVersion(chatId);
    if (!isValid) return;
    // log tung cai ra
    console.log(email, fullName, phoneNumber);


    const payload = {
        addressId: "",
        address: "",
        email: email,
        fullName: fullName,
        phoneNumber: phoneNumber
    };

    try {
        const response = await axios.put(
            'https://api-v2.ticketbox.vn/event/api/v1/directories/addresses',
            payload
        );

        const result = response.data.data.result;
        const successMessage = `
*Đăng ký thành công!*
*ID:* \`${result.id}\`
*Họ tên:* ${result.fullName}
*Email:* ${result.email}
*Số điện thoại:* ${result.phoneNumber}
*Địa chỉ:* ${result.fullAddress || 'Không có'}
        `;

        await bot.sendMessage(chatId, successMessage, {
            parse_mode: 'Markdown'
        });
    } catch (error) {
        console.error('Register API error:', error);
        await bot.sendMessage(chatId, 'Đã xảy ra lỗi khi gửi thông tin của bạn.', {
            parse_mode: 'Markdown'
        });
    }
});



// VALIDATION
bot.onText(/^\/search$/, async (msg) => {
    const chatId = msg.chat.id;

    const isValid = await validateKeyAndVersion(chatId);
    if (!isValid) return;

    await bot.sendMessage(chatId, 'Vui lòng nhập từ khóa tìm kiếm sau lệnh /search. Ví dụ: /search concert');
});

bot.onText(/^\/pick$/, async (msg) => {
    const chatId = msg.chat.id;

    const isValid = await validateKeyAndVersion(chatId);
    if (!isValid) return;

    await bot.sendMessage(chatId, 'Vui lòng nhập ID sự kiện sau lệnh /pick. Ví dụ: /pick 12345');
});

// Handle /register command
bot.onText(/^\/config$/, async (msg) => {
    const chatId = msg.chat.id;

    const isValid = await validateKeyAndVersion(chatId);
    if (!isValid) return;

    await bot.sendMessage(chatId, 'Vui lòng nhập thông tin của bạn theo định dạng sau:\n\n`/config email fullname phoneNumber`\n\nVí dụ:\n`/config example@gmail.com "Nguyễn Văn A" 0981234567`', {
        parse_mode: 'Markdown'
    });
});


// Function to send event page
const sendEventPage = async (chatId, page, messageId) => {
    const events = userSearchResults[chatId];
    const event = events[page];
    const totalPages = events.length;

    const text = `*ID:* \`${event.id}\`\n*Tên sự kiện:* ${event.name}\n*Ngày:* ${event.day}\n*Giá vé:* ${event.price}\n*Trạng thái:* ${event.badge}\n*Thông tin thêm:* [Link](${event.deeplink})`;

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

// Handle callback queries for pagination and inline keyboard buttons
// Handle callback queries for pagination and inline keyboard buttons
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    const messageId = callbackQuery.message.message_id;

    // Xử lý các nút điều hướng trang chỉ khi đang xem kết quả tìm kiếm
    if (data === 'prev' || data === 'next') {
        if (!userSearchResults[chatId]) {
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Không có kết quả tìm kiếm nào.' });
            return;
        }

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
    }
    // Xử lý các nút lệnh
    else if (data === 'key') {
        // Thay vì dùng emit, gọi trực tiếp hàm xử lý key
        const isValid = await validateKeyAndVersion(chatId);
        if (isValid) {
            await bot.sendMessage(chatId, 'Key đã được kích hoạt!', {
                parse_mode: 'Markdown',
            });
        }
    } else if (data === 'search') {
        await bot.sendMessage(chatId, 'Vui lòng nhập từ khóa tìm kiếm sau lệnh /search. Ví dụ: /search concert');
    } else if (data === 'pick') {
        await bot.sendMessage(chatId, 'Vui lòng nhập ID sự kiện sau lệnh /pick. Ví dụ: /pick 12345');
    } else if (data === 'config') {
        await bot.sendMessage(chatId, 'Vui lòng nhập thông tin của bạn theo định dạng sau:\n\n`/config email fullname phoneNumber`\n\nVí dụ:\n`/config example@gmail.com Nguyễn Văn A 0981234567`', {
            parse_mode: 'Markdown'
        });
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
