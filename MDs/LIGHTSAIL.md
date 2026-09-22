# Getting JagaOS alive on AWS

Written for: the team. This is the one thing still blocking real
deployment evidence. Two possible paths depending on what the organisers'
**AWS Account Login Guide** email actually gave you — I haven't seen it.

---

## Which path we're on

The guide almost certainly gives one of these. Check the attachment and tell
me which:

**Path A — an IAM access key** (an *Access Key ID* + *Secret Access Key*,
usually shown once on a page, sometimes as a downloadable `.csv`). If you
have this, I can drive the AWS CLI directly and provision, configure and
deploy the whole box without you touching the console.

**Path B — console login only** (a username + password, maybe an account ID
or a sign-in URL like `123456789.signin.aws.amazon.com/console`). Console
login is an interactive browser session — I cannot do that part. You click
through Lightsail yourself; I give you the exact clicks and then take over by
SSH once the box exists.

Everything below is ready either way — `deploy/` is fully scripted, this
document just needs the last step filled in.

---

## Path A — CLI (if you have an access key)

Give me the two values (Access Key ID + Secret Access Key) and, if shown, the
region — should be `ap-southeast-1` (Singapore) per the starter kit and the
briefing deck. I'll run:

```bash
aws configure   # or export AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_DEFAULT_REGION

aws lightsail import-key-pair \
  --instance-name jaga \
  --key-pair-name jaga-key \
  --public-key-base64 "$(base64 -i ~/.ssh/id_ed25519.pub)"

aws lightsail create-instances \
  --instance-names jaga \
  --availability-zone ap-southeast-1a \
  --blueprint-id ubuntu_24_04 \
  --bundle-id medium_3_0 \
  --key-pair-name jaga-key

aws lightsail open-instance-public-ports \
  --instance-name jaga \
  --port-info fromPort=80,toPort=80,protocol=TCP
aws lightsail open-instance-public-ports \
  --instance-name jaga \
  --port-info fromPort=443,toPort=443,protocol=TCP

aws lightsail get-instance --instance-name jaga --query 'instance.publicIpAddress'
```

`medium_3_0` is the ~4 GB/2 vCPU tier from ARCHITECTURE.md §8 (~$24 USD/month
— comfortably inside the $100 credit for the sprint). Then:

```bash
scp -i ~/.ssh/id_ed25519 -r deploy ubuntu@<IP>:/tmp/jaga-deploy
ssh -i ~/.ssh/id_ed25519 ubuntu@<IP> "sudo mkdir -p /opt/jaga && sudo cp -r /tmp/jaga-deploy /opt/jaga/deploy && sudo /opt/jaga/deploy/bootstrap.sh"
```

That's the whole provision. From there it's `git clone` the backend into
`/opt/jaga/backend`, `.env`, `pip install`, `systemctl restart …` — the last
lines of `bootstrap.sh` say exactly that.

---

## Path B — console (if login is username/password only)

1. **console.aws.amazon.com** → sign in with the guide's URL/username/password
   → confirm top-right shows **Asia Pacific (Singapore) ap-southeast-1**
2. Search **Lightsail** → **Create instance**
3. Instance location: **Singapore, Zone A** · Platform: **Linux** ·
   Blueprint: **Ubuntu 24.04 LTS**
4. Plan: **$24 USD/month** — 4 GB RAM, 2 vCPUs, 80 GB SSD
5. Under **SSH key pair**, click **Change** → **Upload a new key pair** if
   offered, and paste the contents of your local `~/.ssh/id_ed25519.pub`
   (I already found this key on your machine). If Lightsail doesn't let you
   upload one at creation, use its default key — download the `.pem` it
   offers and tell me where you saved it, I'll use that instead.
6. Name it `jaga` → **Create instance**
7. Once running, open **Networking** tab → add firewall rules for **HTTP
   (80)** and **HTTPS (443)** if not already present
8. Copy the **public IP** shown on the instance card and send it to me

From your public IP, I take it from here — same `scp` + `bootstrap.sh` steps
as Path A, just run manually against the IP you give me instead of one the
CLI printed.

---

## What happens once the box exists (either path)

1. `bootstrap.sh` — packages, Caddy, firewall, `jaga` user, systemd units
   (all already written in `deploy/`)
2. Backend code lands in `/opt/jaga/backend`, `.env` with the gateway key
3. `systemctl restart caddy jaga-api jaga-bot jaga-scheduler`
4. `curl https://<ip-or-domain>/api/health` → 200 = deployment evidence, done
5. That URL goes straight into the submission's **Deployment evidence/URL**
   field (SUBMISSION.md §1)

## Guardrails once it's live

- **Never commit `.env` or the gateway key** — same key that's visible in
  your kickoff screenshots; keep it out of the public repo (GAPS.md, §5 of
  SUBMISSION.md)
- Track spend against the **USD 100 credit** — this instance alone is
  well inside it; the risk is Bedrock token usage, not compute. `haiku` for
  routing keeps that cheap (ARCHITECTURE.md §1)
- I will not touch anything that spends beyond standing up this one instance
  without checking with you first
