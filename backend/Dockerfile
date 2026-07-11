FROM node:22-slim

WORKDIR /app

COPY package.json ./
COPY server.js ./

ENV NODE_ENV=production
ENV PORT=7860

EXPOSE 7860

CMD ["npm", "start"]
