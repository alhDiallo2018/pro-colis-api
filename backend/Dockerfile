FROM dart:stable

WORKDIR /app

# Copier les fichiers de dépendances
COPY pubspec.* ./
RUN dart pub get

# Copier le code source
COPY . .

# Créer le dossier uploads
RUN mkdir -p uploads/parcels uploads/profiles

EXPOSE 8080

CMD ["dart", "run", "bin/server.dart"]