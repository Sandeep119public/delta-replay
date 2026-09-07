FROM node:22-alpine AS build
WORKDIR /app
ARG VITE_API_URL=http://localhost:8000/api/v1
ENV VITE_API_URL=$VITE_API_URL
COPY frontend/package.json /app/package.json
RUN npm install
COPY frontend /app
RUN npm run build
FROM node:22-alpine
WORKDIR /app
RUN npm install -g serve
COPY --from=build /app/dist /app/dist
EXPOSE 4173
CMD ["serve", "-s", "/app/dist", "-l", "4173"]
