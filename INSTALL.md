# Install

One-time setup you do by hand before the orchestrator starts, taken from "Before launch" in `docs/build-plan.md`. Agents never do these steps: they need your credentials.

Placeholders: `<account-id>` is your AWS account, `<owner>/<repo>` is the GitHub repo, `<admin-profile>` is an AWS profile with full permissions (for example `aiengineer`).

## H0, part 1: setup

### 1. Tools

Linux notebook (AMD64), with Docker, Node.js LTS, pnpm, the AWS CLI v2, the GitHub CLI (`gh`) and Claude Code already installed.

```bash
curl -fsSL https://herdr.dev/install.sh | sh    # or: brew install herdr
herdr status                                    # server must be running
pipx install pre-commit
```

### 2. Skills

- herdr agent skill for the orchestrator: `skills/herdr/SKILL.md` from the herdr repo (recorded in `skills-lock.json`).
- Agent Skills, inside Claude Code:

  ```text
  /plugin marketplace add addyosmani/agent-skills
  /plugin install agent-skills@addy-agent-skills
  ```

### 3. ARM64 builds (QEMU and Buildx)

The notebook is AMD64 and Fargate is ARM64.

```bash
docker run --privileged --rm tonistiigi/binfmt --install arm64
docker buildx create --name arm-builder --use
docker buildx inspect --bootstrap    # must list linux/arm64
```

### 4. Pre-commit hooks

S01 adds `.pre-commit-config.yaml`. After the orchestrator merges it:

```bash
pre-commit install --hook-type pre-commit --hook-type pre-push
```

### 5. GitHub

1. Create the public repo. Its `CLAUDE.md` holds the decisions table and the out-of-scope list.
2. Settings, Environments: create `demo` and `infra`, each with you as required reviewer, and `teardown` with no reviewer.
3. Settings, Developer settings, Fine-grained tokens: create a token for the orchestrator only, with Contents and Pull requests read/write, Actions read, and nothing else. Export it in the orchestrator's pane only:

   ```bash
   export GH_TOKEN=<token>
   ```

   Other agents get no GitHub token.
4. Add the access code as a repo secret. Generate a random code, then set it with your own `gh` login (`gh auth login` first if needed), not the orchestrator's `GH_TOKEN`:

   ```bash
   openssl rand -base64 18 | tr -d '/+=' | head -c 20    # generate the code, copy it
   gh secret set DEMO_ACCESS_CODE --repo <owner>/<repo>  # paste it at the prompt
   gh secret list --repo <owner>/<repo>                  # confirm it's listed
   ```

   Paste at the prompt instead of using `--body`, so the value stays out of your shell history. Store the code in your password manager.

   Locally, the code comes from the `DEMO_ACCESS_CODE` environment variable. Never commit it. The SSM parameter created by the persistent stack is a separate copy: after the deploy in H0 part 2, set it by hand to the same code (or another one).

### 6. AWS

**Agent profile `supplier-dev`.** Create an IAM user for agents, attach [supplier-dev-policy.json](supplier-dev-policy.json) to it, create an access key, and configure the profile:

```bash
aws configure --profile supplier-dev    # region us-east-1
```

The policy allows invoking Nova 2 Sonic, `connect:StartWebRTCContact`, reading the traces bucket and CloudWatch logs. It explicitly denies `ecs:*`, `elasticloadbalancing:*`, `cloudformation:*`, `iam:*`, `ec2:RunInstances` and `sts:AssumeRole`. Agents use only this profile.

**Admin profile.** Configure the profile for the user with full permissions:

```bash
aws configure --profile <admin-profile>       # IAM user with access keys
# or, for IAM Identity Center:
aws configure sso --profile <admin-profile>
aws sso login --profile <admin-profile>
```

Use it only for the manual steps below (bootstrap and the persistent-stack deploy). Never export it in an agent's pane, and make sure `AWS_PROFILE` is not set to `supplier-dev` when you use it.

**Bootstrap CDK** (once, `us-east-1`):

```bash
aws sts get-caller-identity --profile <admin-profile>    # confirm the account
AWS_PROFILE=<admin-profile> npx cdk bootstrap aws://<account-id>/us-east-1
```

Also enable Bedrock model access for Nova 2 Sonic (`amazon.nova-2-sonic-v1:0`) in `us-east-1` if the console asks for it.

## H1: record five caller clips

Record with your headset mic and save under `fixtures/clips/` as 16 kHz, 16-bit, mono WAV:

| File | Say |
| --- | --- |
| `po-status-a.wav` | A PO-status question |
| `po-status-b.wav` | The same question, different PO |
| `interrupt.wav` | "Wait, stop" |
| `followup-delivery.wav` | "And the delivery date?" |
| `silence-3s.wav` | 3 seconds of silence |

Convert any other format:

```bash
ffmpeg -i in.m4a -ar 16000 -ac 1 -sample_fmt s16 out.wav
```

List the two spoken PO codes in `fixtures/clips/README.md`.

## H0, part 2: after Phase 1

The orchestrator stops and asks. Then:

1. Deploy the persistent stack once from your notebook with admin credentials. It creates the GitHub roles, the reaper, alerts, budgets and Connect. This is a manual `cdk deploy` by you, never by an agent:

   ```bash
   AWS_PROFILE=<admin-profile> pnpm cdk deploy <persistent-stack>
   ```

2. Confirm the alert email subscription (AWS sends a confirmation email).
3. Add the three role ARNs from the stack outputs as repo variables (Settings, Secrets and variables, Actions, Variables), under the names the workflows expect.
4. Run the reaper self-test. It deploys a tiny tagged test stack with a 5-minute expiry. You should get the "created" email, then the "deleted" email within 15 minutes.

   ```bash
   AWS_PROFILE=<admin-profile> pnpm reaper:selftest
   ```

5. In the Amazon Connect admin website:
   - confirm Amazon Connect Customer is enabled for the instance;
   - set the bot's en-US locale to Speech-to-Speech with Amazon Nova Sonic, and build it;
   - set the flow's voice to Matthew (Generative).

   This is manual because configuring it through an API or CloudFormation is unverified (V-09).

## Checklist

- [ ] herdr installed, `herdr status` running, skill installed
- [ ] Agent Skills plugin installed
- [ ] `docker buildx inspect --bootstrap` lists `linux/arm64`
- [ ] pre-commit installed (hooks after S01)
- [ ] GitHub repo, environments `demo` / `infra` / `teardown`, orchestrator `GH_TOKEN`
- [ ] AWS profile `supplier-dev` with the policy attached
- [ ] `cdk bootstrap` done in `us-east-1`
- [ ] Repo secret `DEMO_ACCESS_CODE`
- [ ] Five clips in `fixtures/clips/`
- [ ] After Phase 1: persistent stack deployed, alert email confirmed, role ARNs added, self-test passed, Connect configured
