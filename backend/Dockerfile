# backend/Dockerfile (simplifié)
FROM dart:stable

WORKDIR /app

# Copier les fichiers
COPY pubspec.* ./
RUN dart pub get

COPY . .

# Créer le dossier uploads
RUN mkdir -p uploads/parcels uploads/profiles

EXPOSE 8080

# Lancer directement sans compilation
CMD ["dart", "run", "bin/server.dart"]