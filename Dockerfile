FROM prom/prometheus:latest

USER root

COPY prometheus-config.yml /etc/prometheus/prometheus.yml
COPY replace_uri.sh /bin/replace_uri.sh

RUN chmod +x /bin/replace_uri.sh

USER nobody

ENTRYPOINT [ "/bin/sh", "/bin/replace_uri.sh" ]
CMD        [ "/bin/prometheus", \
             "--config.file=/etc/prometheus/prometheus.yml", \
             "--storage.tsdb.path=/prometheus", \
             "--web.console.libraries=/usr/share/prometheus/console_libraries", \
             "--web.console.templates=/usr/share/prometheus/consoles" ]
