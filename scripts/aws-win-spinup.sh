#!/usr/bin/env bash
# Spin up an ephemeral, publicly-reachable Windows Server EC2 instance
# with OpenSSH enabled + the caller's pubkey pre-authorized + a known
# Administrator password baked in via user-data.
#
# Usage:
#   aws-win-spinup               # prints status, stashes state, returns
#   eval "$(aws-win-spinup)"     # ALSO sets CLAUDETTE_WIN_* in current shell
#
# Downstream helpers (aws-win-rdp, deploy-win-x64, aws-win-destroy) all
# auto-discover the instance from AWS tags + state files, so env vars
# are optional. State survives shell/direnv reloads because it lives in
# $PRJ_ROOT/.claudette/ (gitignored) rather than $TMPDIR.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_aws-common.sh
source "$SCRIPT_DIR/_aws-common.sh"

# Fallback chain for the default pubkey: ed25519 (99% of dev Macs),
# then rsa, then the legacy project key. SPINUP_PUB_KEY overrides.
if [ -n "${SPINUP_PUB_KEY:-}" ]; then
  PUB_KEY_FILE="$SPINUP_PUB_KEY"
elif [ -r "$HOME/.ssh/id_ed25519.pub" ]; then
  PUB_KEY_FILE="$HOME/.ssh/id_ed25519.pub"
elif [ -r "$HOME/.ssh/id_rsa.pub" ]; then
  PUB_KEY_FILE="$HOME/.ssh/id_rsa.pub"
else
  PUB_KEY_FILE="$HOME/.ssh/dev.urandom.io.pub"
fi
SG_NAME="${SPINUP_SG_NAME:-claudette-spinup-sg}"
INSTANCE_TYPE="${SPINUP_INSTANCE_TYPE:-t3.medium}"
NAME_TAG="${SPINUP_NAME_TAG:-claudette-spinup-$(date +%Y%m%d-%H%M%S)}"
AMI_FILTER="${SPINUP_AMI_FILTER:-Windows_Server-2022-English-Full-Base-*}"
# Admin password: 32 hex chars + Aa1! to hit all four Windows
# local-policy character classes without introducing characters that
# need PowerShell escaping.
ADMIN_PASS="${SPINUP_ADMIN_PASSWORD:-$(openssl rand -hex 16)Aa1!}"

[ -r "$PUB_KEY_FILE" ] || { log "pubkey $PUB_KEY_FILE not readable"; exit 1; }
PUBKEY=$(cat "$PUB_KEY_FILE")
log "pubkey: $PUB_KEY_FILE"

# No EC2 key pair is imported: ed25519 is rejected for Windows AMIs
# ("ED25519 key pairs are not supported with Windows AMIs") and we
# don't need one because user-data installs the pubkey directly. Side
# benefit: get-password-data becomes a non-option, forcing the simpler
# user-data-password path.

# 1. Security group: 22 + 3389 open to 0.0.0.0/0 (ephemeral).
VPC_ID=$(aws_ ec2 describe-vpcs \
  --filters "Name=is-default,Values=true" \
  --query 'Vpcs[0].VpcId' --output text)
[ "$VPC_ID" != "None" ] || { log "no default VPC in $AWS_WIN_REGION"; exit 1; }
SG_ID=$(aws_ ec2 describe-security-groups \
  --filters "Name=group-name,Values=$SG_NAME" "Name=vpc-id,Values=$VPC_ID" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo None)
if [ "$SG_ID" = "None" ] || [ -z "$SG_ID" ]; then
  log "creating security group $SG_NAME in $VPC_ID"
  SG_ID=$(aws_ ec2 create-security-group \
    --group-name "$SG_NAME" \
    --description "Claudette ephemeral Windows test SG (SSH+RDP public)" \
    --vpc-id "$VPC_ID" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Project,Value=claudette-spinup}]" \
    --query 'GroupId' --output text)
  aws_ ec2 authorize-security-group-ingress --group-id "$SG_ID" \
    --ip-permissions \
      'IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=0.0.0.0/0,Description=ssh}]' \
      'IpProtocol=tcp,FromPort=3389,ToPort=3389,IpRanges=[{CidrIp=0.0.0.0/0,Description=rdp}]' \
    >/dev/null
fi
log "security group: $SG_ID"

# 2. Latest Windows Server 2022 AMI (amazon-owned).
AMI_ID=$(aws_ ec2 describe-images --owners amazon \
  --filters "Name=name,Values=$AMI_FILTER" "Name=architecture,Values=x86_64" "Name=state,Values=available" \
  --query 'sort_by(Images, &CreationDate)[-1].ImageId' --output text)
[ -n "$AMI_ID" ] && [ "$AMI_ID" != "None" ] || { log "no AMI matching $AMI_FILTER"; exit 1; }
log "AMI: $AMI_ID"

# 3. Render user-data. EC2Launch v2 runs the <powershell> block once on
# first boot; Windows Server 2022 ships OpenSSH Server pre-installed.
USER_DATA=$(mktemp)
trap 'rm -f "$USER_DATA"' EXIT
cat > "$USER_DATA" <<EOF
<powershell>
\$ErrorActionPreference = 'Stop'
try {
  # Pin the Administrator password first so RDP is usable even if the
  # rest of the block fails. PowerShell single-quote string is literal,
  # and ADMIN_PASS only contains hex + Aa1! so no escaping needed.
  net user Administrator '$ADMIN_PASS' | Out-Null

  Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 -ErrorAction SilentlyContinue | Out-Null
  Set-Service -Name sshd -StartupType Automatic
  Start-Service sshd
  if (!(Test-Path 'C:\ProgramData\ssh')) { New-Item -ItemType Directory -Path 'C:\ProgramData\ssh' | Out-Null }
  \$authKey = 'C:\ProgramData\ssh\administrators_authorized_keys'
  \$pub = @'
$PUBKEY
'@
  Set-Content -Path \$authKey -Value \$pub -Encoding ascii
  icacls.exe \$authKey /inheritance:r /grant 'Administrators:F' /grant 'SYSTEM:F' | Out-Null
  if (-not (Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null
  }
  New-ItemProperty -Path 'HKLM:\SOFTWARE\OpenSSH' -Name DefaultShell -Value 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -PropertyType String -Force | Out-Null
  Restart-Service sshd
} catch {
  Write-Host "user-data error: \$_"
  throw
}
</powershell>
<persist>false</persist>
EOF

# 4. Launch. Intentionally no --key-name (see note above).
log "launching $INSTANCE_TYPE ($NAME_TAG)"
INSTANCE_ID=$(aws_ ec2 run-instances \
  --image-id "$AMI_ID" \
  --instance-type "$INSTANCE_TYPE" \
  --security-group-ids "$SG_ID" \
  --user-data "file://$USER_DATA" \
  --metadata-options 'HttpTokens=required,HttpEndpoint=enabled' \
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=50,VolumeType=gp3,DeleteOnTermination=true}' \
  --tag-specifications \
    "ResourceType=instance,Tags=[{Key=Project,Value=claudette-spinup},{Key=Name,Value=$NAME_TAG}]" \
    "ResourceType=volume,Tags=[{Key=Project,Value=claudette-spinup},{Key=Name,Value=$NAME_TAG}]" \
  --query 'Instances[0].InstanceId' --output text)
log "instance: $INSTANCE_ID — waiting for running state"
aws_ ec2 wait instance-running --instance-ids "$INSTANCE_ID"
PUBLIC_IP=$(instance_public_ip "$INSTANCE_ID")
log "public IP: $PUBLIC_IP — waiting for sshd (Windows first-boot + user-data is slow, ~5-8 min)"

# 5. Poll sshd via ssh-keyscan (no auth needed — just confirms sshd
# finished starting, which on Windows is the slow part).
DEADLINE=$(( $(date +%s) + 900 ))
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  if ssh-keyscan -T 5 -t rsa "$PUBLIC_IP" 2>/dev/null | grep -q ssh-rsa; then
    log "sshd ready"
    break
  fi
  sleep 15
done
if [ "$(date +%s)" -ge "$DEADLINE" ]; then
  log "timed out waiting for sshd on $PUBLIC_IP (instance $INSTANCE_ID)"
  log "inspect with: aws --profile $AWS_WIN_PROFILE --region $AWS_WIN_REGION ec2 get-console-output --instance-id $INSTANCE_ID --latest --output text"
  exit 1
fi

# 6. Persist instance info to the project-scoped state dir so
# downstream helpers work from any shell, including after a
# direnv reload. Password is in a mode-600 sidecar.
( umask 077; printf '%s' "$ADMIN_PASS" > "$(state_file "$INSTANCE_ID" pass)" )
printf '%s\n' "$INSTANCE_ID" > "$STATE_DIR/current"

# 7. Emit exports on stdout so `eval "$(aws-win-spinup)"` works for
# callers who want env vars. All downstream helpers work without them.
cat <<EOF
export CLAUDETTE_WIN_HOST=Administrator@$PUBLIC_IP
export CLAUDETTE_WIN_REMOTE_PATH=Desktop/claudette.exe
export CLAUDETTE_WIN_INSTANCE_ID=$INSTANCE_ID
export CLAUDETTE_WIN_ADMIN_PASSWORD='$ADMIN_PASS'
# Host:    $PUBLIC_IP
# SSH:     ssh Administrator@$PUBLIC_IP
# RDP:     aws-win-rdp            # macOS; opens Windows App with password on clipboard
# Deploy:  deploy-win-x64
# Destroy: aws-win-destroy
EOF
