# Secrets locaux de la stack

Creer quatre fichiers, sans saut de ligne superflu et avec des permissions
`0600` :

- `metrics_token` : la meme valeur que `METRICS_TOKEN` dans l'API ;
- `grafana_admin_password` : mot de passe du compte Grafana `admin` ;
- `brevo_smtp_key` : cle SMTP Brevo, differente de la cle API HTTP ;
- `postgres_monitor_password` : mot de passe du role PostgreSQL `pg_monitor`.

Ces fichiers sont ignores par Git. Utiliser au minimum 32 caracteres aleatoires
pour `metrics_token` et le mot de passe Grafana.
