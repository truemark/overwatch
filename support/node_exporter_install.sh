ARCH=$(uname -m)
if [ "$ARCH" == "x86_64" ]; then
  NODE_EXPORTER_PACKAGE_URL='{{ NodeExporterPackageUrl }}'
elif [ "$ARCH" == "aarch64" ]; then
  NODE_EXPORTER_PACKAGE_URL='{{ NodeExporterPackageUrlArm }}'
else
  echo 'Unsupported architecture: $ARCH'
  exit 1
fi
sudo useradd --no-create-home --shell /bin/false prometheus | >/dev/null 2>&1
sudo mkdir -p /etc/prometheus
sudo mkdir -p /var/lib/prometheus
sudo chown prometheus:prometheus /etc/prometheus
sudo chown prometheus:prometheus /var/lib/prometheus
echo 'Downloading and configuring Node Exporter'
sudo systemctl stop node_exporter >/dev/null 2>&1
wget $NODE_EXPORTER_PACKAGE_URL >/dev/null 2>&1
tar xfz node_exporter-*.tar.gz
mv node_exporter-*64 node_exporter
sudo rm -rf /etc/prometheus/node_exporter
sudo mv node_exporter/ /etc/prometheus/node_exporter/
rm node_exporter-*.tar.gz
sudo chown -R prometheus:prometheus /etc/prometheus/node_exporter
sudo echo "{{ NodeExporterServiceConfig }}" > /etc/systemd/system/node_exporter.service
sudo systemctl daemon-reload
sudo systemctl enable node_exporter >/dev/null 2>&1
sudo systemctl start node_exporter
