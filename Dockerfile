FROM ubuntu:24.04
ENV TZ=Etc/UTC
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone && \
    apt update && \
    apt upgrade -y && \
    apt install -y python3 python3-venv nodejs npm lsof curl && \
    curl -s https://gitlab.com/gitlab-com/support/toolbox/fast-stats/-/jobs/8353044402/artifacts/raw/fast-stats-linux -o /usr/local/bin/fast-stats && \
    chmod +x /usr/local/bin/fast-stats
COPY /backend /backend
COPY /frontend /frontend
COPY start.py /start.py

EXPOSE 3000 
EXPOSE 8000 
EXPOSE 8080
COPY <<EOF /entrypoint.sh
#!/bin/bash
echo "0.0.0.0 localhost" > /etc/hosts
exec /usr/bin/python3 -u /start.py
EOF

RUN chmod +x /entrypoint.sh
CMD ["/entrypoint.sh"]

