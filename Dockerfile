FROM node:22-alpine AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM golang:1.22-alpine AS backend
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
COPY --from=frontend /src/backend/static ./static
RUN CGO_ENABLED=0 go build -o /bin/nova .

FROM alpine:3.21
RUN addgroup -S nova && adduser -S nova -G nova
USER nova
COPY --from=backend /bin/nova /bin/nova
EXPOSE 8080
ENTRYPOINT ["/bin/nova"]
