FROM node:20-alpine AS build
WORKDIR /app
ARG PUBLIC_API_URL=http://localhost:4000
ENV PUBLIC_API_URL=$PUBLIC_API_URL
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
RUN npm install -g serve@14
COPY --from=build /app/dist ./dist
EXPOSE 4321
CMD ["serve", "-s", "dist", "-l", "4321"]
