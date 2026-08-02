FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npx prisma generate
RUN npm run build

EXPOSE 3000

# Sync the database schema (creates tables on first boot, no-op afterwards)
# before starting the server, so deployment requires zero manual DB setup.
CMD ["sh", "-c", "npx prisma db push --skip-generate && npm start"]
