require('dotenv').config()
const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");
const {
  Client,
  GatewayIntentBits,
  ButtonBuilder,
  ActionRowBuilder,
  EmbedBuilder,
  ButtonStyle
} = require("discord.js");
const Order = require("./Order");
const BoosterRating = require("./BoosterRating");
const Notification = require("./Notification");

function generateShortId() {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 5; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return `ORDER-${result}`;
}


const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID

const tgBot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

const dcBot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})

const userSteps = {};

const mainMenu = {
  reply_markup: {
    keyboard: [
      [{ text: "📜 Правила" }, { text: "💰 Цены" }],
      [{ text: "🛒 Оформить заказ" }],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  },
};

const rulesText = "Здесь текст правил.";
const pricesText = "Здесь текст с ценами.";


tgBot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (userSteps[chatId] && userSteps[chatId].step === "awaiting_review") {
    const orderId = userSteps[chatId].orderId;
    const review = text;

    try {
      const order = await Order.findOne({ orderId: orderId });
      if (!order) {
        return tgBot.sendMessage(chatId, "❌ Заказ не найден.");
      }

      if (chatId.toString() !== order.customerId) {
        return tgBot.sendMessage(
          chatId,
          "❌ Вы не можете оставить отзыв к этому заказу, так как не являетесь его заказчиком."
        );
      }

      let boosterRating = await BoosterRating.findOne({
        boosterId: order.boosterId,
      });
      if (boosterRating && boosterRating.comments.some(comment => comment.orderId === orderId && comment.userId === order.customerId)) {
        return tgBot.sendMessage(
          chatId,
          "❌ Вы уже оставляли отзыв к этому заказу."
        );
      }

      order.review = review;
      await order.save();

      if (!boosterRating) {
        boosterRating = new BoosterRating({
          boosterId: order.boosterId,
          ratings: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
          totalRatings: 0,
          averageRating: 0,
          ratedBy: [],
          comments: [],
        });
      }

      boosterRating.comments.push({
        userId: order.customerId,
        orderId: orderId,
        comment: review,
        source: 'telegram',
      });

      await boosterRating.save();

      await createNotification("reviewed", orderId, null, review);

      tgBot.sendMessage(chatId, `✅ Спасибо за ваш отзыв! Он был сохранен.`);
    } catch (error) {
      console.error("Ошибка при сохранении отзыва:", error);
      tgBot.sendMessage(
        chatId,
        "❌ Произошла ошибка при сохранении отзыва."
      );
    } finally {
      delete userSteps[chatId];
    }

    return; 
  }

  if (text === "/start") {
    return tgBot.sendMessage(
      chatId,
      "Здравствуйте! Изучите правила и цены буста, после чего нажмите на 'Оформить заказ'",
      mainMenu
    );
  }


  if (text === "📜 Правила") {
    return tgBot.sendMessage(chatId, rulesText);
  } else if (text === "💰 Цены") {
    return tgBot.sendMessage(chatId, pricesText);
  } else if (text === "🛒 Оформить заказ") {
    tgBot.sendMessage(chatId, "Давайте оформим заказ. Введите имя:");
    userSteps[chatId] = { step: 1, data: {} };
    return;
  }


  if (!userSteps[chatId]) return;

  switch (userSteps[chatId].step) {
    case 1:
      userSteps[chatId].data.name = text;
      tgBot.sendMessage(chatId, "Теперь введи описание:");
      userSteps[chatId].step = 2;
      break;
    case 2:
      userSteps[chatId].data.description = text;
      const orderId = generateShortId();
      const newOrder = new Order({
        orderId,
        name: userSteps[chatId].data.name,
        description: userSteps[chatId].data.description,
        customerId: chatId.toString(),
        customerAvatarURL: `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUserProfilePhotos?user_id=${msg.from.id}`,
        customerName: msg.from.username,
        source: 'telegram'
      });

      try {
        await newOrder.save();
        tgBot.sendMessage(chatId, `✅ Заказ создан! ID: ${orderId}`);
        sendToDiscord(newOrder);
      } catch (error) {
        console.error("Ошибка при создании заказа:", error);
        tgBot.sendMessage(
          chatId,
          "❌ Произошла ошибка при создании заказа. Пожалуйста, попробуйте позже."
        );
      }

      delete userSteps[chatId];
      break;
  }
});

tgBot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;
    const userId = query.from.id;
  
   if (data.startsWith("confirm_order_")) {
      const orderId = data.split("_")[2];
      await handleConfirmOrder(chatId, messageId, orderId);
    } else if (data.startsWith("cancel_order_")) {
      const orderId = data.split("_")[2];
      await handleCancelOrder(chatId, messageId, orderId);
    } else if (data.startsWith("rate_")) {
      const [orderId, rating] = data.split("_").slice(1);
      await handleRateOrder(chatId, messageId, orderId, rating);
    } else if (data.startsWith("add_review_")) {
      const orderId = data.split("_")[2];
      userSteps[chatId] = {
        step: "awaiting_review",
        orderId: orderId,
      };
      tgBot.sendMessage(chatId, "Пожалуйста, введите ваш отзыв:");
    }
  });
  

async function handleTakeOrder(userId, chatId, orderId) {
    try {
      const order = await Order.findOne({ orderId: orderId });
      if (!order) {
        return tgBot.sendMessage(chatId, "❌ Заказ не найден.");
      }
  
      if (order.status !== "Ожидает выполнения") {
        return tgBot.sendMessage(
          chatId,
          "❌ Этот заказ уже взят в работу или выполнен."
        );
      }
  
      order.status = "В работе";
      order.boosterId = chatId; 
      order.boosterTelegramId = chatId;
      await order.save();
  
      tgBot.sendMessage(
        chatId,
        `✅ Вы взяли заказ ${orderId} в работу.`
      );
  
      const inlineKeyboard = {
          inline_keyboard: [
              [
                  { text: '✅ Подтвердить', callback_data: `confirm_order_${orderId}` },
                  { text: '❌ Отменить', callback_data: `cancel_order_${orderId}` },
              ],
          ],
      };
      tgBot.sendMessage(
        order.customerId,
        `🎉 **Ваш заказ ${orderId} взят в работу бустером! (Telegram ID: ${chatId})**\n\n**Детали заказа:**\nИмя: ${order.name}\nОписание: ${order.description}`,
        { reply_markup: inlineKeyboard }
      );
  
      sendTakeOrderUpdateToDiscord(orderId, chatId);
    } catch (error) {
      console.error("Ошибка при взятии заказа:", error);
      tgBot.sendMessage(
        chatId,
        "❌ Произошла ошибка при взятии заказа."
      );
    }
  }

async function sendTakeOrderUpdateToDiscord(orderId, telegramBoosterId) {
    try {
        const order = await Order.findOne({ orderId: orderId });
        if (!order) return console.error("❌ Заказ не найден!");
        const channel = await dcBot.channels.fetch(DISCORD_CHANNEL_ID);
        if (!channel) return console.error("❌ Канал не найден!");

        const boosterName = `Telegram ID: ${telegramBoosterId}`;
        const message = await channel.messages.fetch(order.channelMessageId);

        const updatedEmbed = new EmbedBuilder(message.embeds[0])
            .setColor('#FFFF00')
            .setAuthor({ name: `${boosterName} взял заказ в работу!` })
            .setDescription(
                `**Бустер:** ${boosterName}
                **Имя:** ${order.name}
                **Описание:** ${order.description}
                **ID заказа:** ${orderId}
                **Статус:** В работе`
            )
            .setFooter({ text: `ID заказа: ${orderId}` });

        if (order.customerAvatarURL) {
            updatedEmbed.setThumbnail(order.customerAvatarURL);
        }

        await message.edit({ embeds: [updatedEmbed], components: [] });

    } catch (error) {
        console.error("Ошибка при обновлении информации о заказе в Discord:", error);
    }
}

async function sendToDiscord(order) {
    const channel = await dcBot.channels.fetch(DISCORD_CHANNEL_ID);
    if (!channel) return console.error("❌ Канал не найден!");
  
    let customerAvatarURL = order.customerAvatarURL;
    try {
      const userPhotos = await tgBot.getUserProfilePhotos(order.customerId);
      if (userPhotos.total_count > 0) {
        const photo = userPhotos.photos[0][0];
        const fileInfo = await tgBot.getFile(photo.file_id);
        customerAvatarURL = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${fileInfo.file_path}`;
      } else {
        customerAvatarURL = "";
      }
    } catch (error) {
      console.error("Ошибка при получении фото пользователя:", error);
      customerAvatarURL = "";
    }
  
    const embed = new EmbedBuilder()
      .setTitle("Новый заказ!")
      .setDescription(`
        **Имя:** ${order.name}
        **Никнейм:** ${order.customerName}
         **Описание:** ${order.description}
        **ID заказа:** ${order.orderId}
        **Статус:** ${order.status}
        `)
      .setColor(0x00ff00)
      .setFooter({ text: "Отправлено из Telegram" });
  
    if (customerAvatarURL) {
      embed.setThumbnail(customerAvatarURL);
    }
  
    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`take_order_${order.orderId}`)
        .setLabel("Взять заказ")
        .setStyle(ButtonStyle.Primary) 
    );
  
    const message = await channel.send({
      embeds: [embed],
      components: [buttons],
    });
  
    order.channelMessageId = message.id;
    order.customerAvatarURL = customerAvatarURL;
    order.customerName = order.customerName;
    await order.save();
  }
  
  async function handleCancelOrder(chatId, messageId, orderId) {
    try {
      const order = await Order.findOne({ orderId: orderId });
      if (!order) {
        return tgBot.sendMessage(chatId, "❌ Заказ не найден.");
      }
  
      if (order.status !== "В работе") {
        return tgBot.sendMessage(
          chatId,
          "❌ Этот заказ уже не находится в работе."
        );
      }
  
      order.status = "Отменён покупателем";
      await order.save();
  
      await createNotification("cancelled", orderId);

      try {
        const channel = await dcBot.channels.fetch(DISCORD_CHANNEL_ID);
        const message = await channel.messages.fetch(order.channelMessageId);
        const embed = new EmbedBuilder(message.embeds[0])
          .setColor("#FF0000")
          .setTitle("Заказ отменен покупателем!")
          .setDescription(
            `
            **Заказчик:** ${
              order.customerUsername
                ? `@${order.customerUsername}`
                : order.customerName
            } (Telegram)
            **Бустер:** Telegram ID: ${order.boosterId}
            **Имя:** ${order.name}
            **Описание:** ${order.description}
            **ID заказа:** ${order.orderId}
            **Статус:** Отменён покупателем`
          )
          .setThumbnail(order.customerAvatarURL)
          .setFooter({
            text: `Заказ ID: ${order.orderId}, отменен покупателем`,
          });
        await message.edit({ embeds: [embed], components: [] });
      } catch (error) {
        console.error("Ошибка при обновлении сообщения в Discord:", error);
      }

  
      tgBot.editMessageText(`❌ Заказ ${orderId} отменен.`, {
        chat_id: chatId,
        message_id: messageId,
      });
    } catch (error) {
      console.error("Ошибка при отмене заказа:", error);
      tgBot.sendMessage(chatId, "❌ Произошла ошибка при отмене заказа.");
    }
  }

  async function handleConfirmOrder(chatId, messageId, orderId) {
    try {
      const order = await Order.findOne({ orderId: orderId });
      if (!order) {
        return tgBot.sendMessage(chatId, "❌ Заказ не найден.");
      }
  
      if (order.status !== "В работе") {
        return tgBot.sendMessage(
          chatId,
          "❌ Этот заказ уже не находится в работе."
        );
      }

      order.status = "Завершён";
      await order.save();
    
      await createNotification("confirmed", orderId);
    
      try {
        const channel = await dcBot.channels.fetch(DISCORD_CHANNEL_ID);
        const message = await channel.messages.fetch(order.channelMessageId);
        const embed = new EmbedBuilder(message.embeds[0])
          .setColor("#00FF00")
          .setDescription(
            `**Заказ выполнен!**
            **Заказчик:** ${order.name} (Telegram)
            **Бустер:** Telegram ID: ${order.boosterId}
            **Имя:** ${order.name}
            **Описание:** ${order.description}
            **ID заказа:** ${order.orderId}
            **Статус:** Завершён`
          )
          .setThumbnail(order.customerAvatarURL)
          .setFooter({
            text: `Заказ ID: ${order.orderId}, подтверждён покупателем`,
          });
        await message.edit({ embeds: [embed], components: [] });
      } catch (error) {
        console.error("Ошибка при обновлении сообщения в Discord:", error);
      }
  
      const ratingKeyboard = {
        inline_keyboard: [
          [
            { text: "1⭐", callback_data: `rate_${orderId}_1` },
            { text: "2⭐", callback_data: `rate_${orderId}_2` },
            { text: "3⭐", callback_data: `rate_${orderId}_3` },
            { text: "4⭐", callback_data: `rate_${orderId}_4` },
            { text: "5⭐", callback_data: `rate_${orderId}_5` },
          ],
        ],
      };
  
      tgBot.editMessageText(
        `✅ Заказ ${orderId} подтвержден. Пожалуйста, оцените работу бустера:`,
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: ratingKeyboard,
        }
      );
    } catch (error) {
      console.error("Ошибка при подтверждении заказа:", error);
      tgBot.sendMessage(chatId, "❌ Произошла ошибка при подтверждении заказа.");
    }
  }
  
  async function handleRateOrder(chatId, messageId, orderId, rating) {
    try {
      const order = await Order.findOne({ orderId: orderId });
      if (!order) {
        return tgBot.sendMessage(chatId, "❌ Заказ не найден.");
      }
  
      if (chatId.toString() !== order.customerId) {
        return tgBot.sendMessage(
          chatId,
          "❌ Вы не можете оценивать этот заказ, так как не являетесь его заказчиком."
        );
      }
  
      order.rating = parseInt(rating);
      await order.save();
    

      await createNotification("rated", orderId, rating);

      let boosterRating = await BoosterRating.findOne({
        boosterId: order.boosterId,
      });
      if (!boosterRating) {
        boosterRating = new BoosterRating({
          boosterId: order.boosterId,
          ratings: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
          totalRatings: 0,
          averageRating: 0,
          ratedBy: [],
          comments: [],
        });
      }
  
      boosterRating.ratings[rating]++;
      boosterRating.totalRatings++;
      boosterRating.averageRating =
        Object.keys(boosterRating.ratings).reduce(
          (sum, key) => sum + boosterRating.ratings[key] * parseInt(key),
          0
        ) / boosterRating.totalRatings;
  
      boosterRating.ratedBy.push(order.customerId);
  
      await boosterRating.save();
  
      const reviewButton = {
        inline_keyboard: [
          [{ text: "Оставить отзыв", callback_data: `add_review_${orderId}` }],
        ],
      };
  
      tgBot.editMessageText(
        `✅ Спасибо за вашу оценку! Вы поставили ${rating} звезд(ы).`,
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: reviewButton,
        }
      );
    } catch (error) {
      console.error("Ошибка при оценке заказа:", error);
      tgBot.sendMessage(
        chatId,
        "❌ Произошла ошибка при оценке заказа."
      );
    }
  }

  async function createNotification(type, orderId, rating = null, review = null) {
    try {
      const order = await Order.findOne({ orderId: orderId });
      if (!order) {
        console.error("Не удалось найти заказ для уведомления");
        return;
      }
      const notification = new Notification({
        type,
        orderId,
        rating,
        review,
      });
      await notification.save();
      console.log(`Создано уведомление типа ${type} для заказа ${orderId}`);
    } catch (error) {
      console.error("Ошибка при создании уведомления:", error);
    }
  }

  dcBot.login(DISCORD_TOKEN);
  console.log("✅ Discord-бот запущен!");