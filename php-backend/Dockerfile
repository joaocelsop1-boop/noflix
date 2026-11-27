FROM php:8.2-apache

# Extensão MySQL (PDO) usada pelo config.php
RUN docker-php-ext-install pdo_mysql

# Backend PHP (config/api/stream/login/logout/admin/profiles + database.sql)
COPY . /var/www/html/

# Permissões padrão + cache gravável (api.php usa __DIR__ . '/cache', TTL 3600s)
RUN mkdir -p /var/www/html/cache \
    && find /var/www/html -type d -exec chmod 755 {} \; \
    && find /var/www/html -type f -exec chmod 644 {} \; \
    && chown -R www-data:www-data /var/www/html/cache \
    && chmod 775 /var/www/html/cache

# Apache serve na porta 80; as URLs usam query string (?action=...),
# sem necessidade de mod_rewrite.
EXPOSE 80
