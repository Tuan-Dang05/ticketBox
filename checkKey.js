const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const { createHash } = require('crypto');
const colors = require('colors');
const { machineIdSync } = require('node-machine-id');
const express = require('express');
const session = require('express-session');
const crypto = require('crypto');

const key = machineIdSync();

const getHash = (path) =>
    new Promise((resolve, reject) => {
        const hash = createHash('sha256');
        const rs = fs.createReadStream(path);
        rs.on('error', reject);
        rs.on('data', (chunk) => hash.update(chunk));
        rs.on('end', () => resolve(hash.digest('hex')));
    });

// User activation status
const userActivationStatus = {};


const validateKeyAndVersion = async (chatId) => {
    try {
        const keyResponse = await axios.post('https://anonm.my.eu.org/check_key', {
            machineHash: key,
            game: 'ticket',
        });

        if (!keyResponse.data.status) {
            userActivationStatus[chatId] = false;
            await bot.sendMessage(
                chatId,
                `Nhấn để sao chép key: \`${key}\`\nVui lòng liên hệ [@hd_onus](https://t.me/hd_onus) để kích hoạt!`,
                {
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true,
                }
            );
            return false;
        }

        userActivationStatus[chatId] = true;

        const hashValue = await getHash('./ticket.js');
        const hashResponse = await axios.post('https://anonm.my.eu.org/check_hash', {
            hash: hashValue,
            game: 'ticket2312',
        });

        if (!hashResponse.data.modified) {
            await bot.sendMessage(
                chatId,
                'Phiên bản không hợp lệ. Vui lòng cập nhật phiên bản mới!',
                { parse_mode: 'Markdown' }
            );
            return false;
        }

        return true;
    } catch (error) {
        console.error('Validation error:', error);
        await bot.sendMessage(chatId, 'Đã xảy ra lỗi. Vui lòng thử lại sau!', {
            parse_mode: 'Markdown',
        });
        return false;
    }
};

module.exports = { validateKeyAndVersion };