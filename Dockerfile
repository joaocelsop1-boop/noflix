FROM node:20-alpine

WORKDIR /app

# Dependências primeiro (aproveita o cache de camadas do Docker)
COPY package.json package-lock.json ./
RUN npm ci

# Resto do código e build de produção
COPY . .
RUN npm run build

ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "start"]
