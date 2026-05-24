# backend/Dockerfile
FROM dart:stable AS build

WORKDIR /app

# Copier les fichiers de dépendances
COPY pubspec.* ./
RUN dart pub get

# Copier tout le code
COPY . .

# Créer un dossier pour les uploads
RUN mkdir -p uploads/parcels uploads/profiles

# Compiler en exécutable
RUN dart compile exe bin/server.dart -o server

# Image de production
FROM ubuntu:22.04

# Installer les dépendances système
RUN apt-get update && apt-get install -y \
    libc6 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copier l'exécutable et les assets
COPY --from=build /app/server .
COPY --from=build /app/uploads ./uploads

# Créer un utilisateur non-root
RUN useradd --create-home appuser
USER appuser

EXPOSE 8080

CMD ["./server"]