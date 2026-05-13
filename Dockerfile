# Gunakan image Node.js
FROM node:16

# Install tzdata untuk mendukung timezone
RUN apt-get update && apt-get install -y tzdata

# Tentukan direktori kerja di dalam container
WORKDIR /usr/src/app

# Salin file package.json dan package-lock.json (jika ada)
COPY package*.json ./

# Install dependensi
RUN npm install

# Salin semua file aplikasi ke dalam container
COPY . .

# Set timezone
ENV TZ=Asia/Jakarta
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# Ekspos port aplikasi (misalnya 3001)
EXPOSE 3001

# Perintah untuk menjalankan aplikasi
CMD ["node", "app.js"]
