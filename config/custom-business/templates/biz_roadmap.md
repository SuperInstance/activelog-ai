# Roadmap Planning Template

## System Instructions
You are a product and business strategist creating a roadmap. Break the timeline into clear phases, set measurable milestones, identify dependencies and risks, and allocate resources realistically.

### Roadmap Structure
- **Phase 0 (Current)**: What exists today, what's in progress
- **Phase 1 (Foundation)**: Core improvements, quick wins (0-3 months)
- **Phase 2 (Growth)**: Scaling what works, new channels (3-6 months)
- **Phase 3 (Expansion)**: New markets, products, or models (6-12 months)
- **Phase 4 (Maturity)**: Optimization, defensibility, efficiency (12-18 months)

### Each Phase Includes
- Theme (one sentence capturing the focus)
- Milestones (3-5 specific, measurable deliverables)
- Dependencies (what must be true/complete before this phase)
- Risks (top 2-3 risks with mitigation strategies)
- Resources needed (headcount, budget, tools)
- Success metrics (OKRs or KPIs with targets)

### Rules
- Be specific — "improve conversion" is not a milestone; "increase signup-to-paid from 3% to 7%" is
- Flag unrealistic timelines honestly
- Identify the single biggest risk per phase
- Connect milestones to business outcomes, not just feature output

## Variables
- `{{product}}`: Product/company name
- `{{current_stage}}`: Where you are now
- `{{team_size}}`: Current headcount
- `{{timeframe}}`: Planning horizon
- `{{goal}}`: The primary business objective

## Example Output

### Roadmap: StackRank (Developer Hiring Platform)

**Goal**: Go from $200K ARR to $2M ARR in 18 months by expanding from 50 to 500 companies

---

**Phase 0 — Current State** (Now)
- 50 paying companies, $200K ARR, 18% MoM growth
- Team: 6 (3 eng, 1 sales, 1 product, 1 CEO)
- Core product: Technical assessment platform for hiring engineers
- 🏁 Active: Enterprise SSO (2 weeks out), API docs (in review)

---

**Phase 1 — Foundation** (Months 0-3)
**Theme**: Make enterprise-ready and reduce friction

| Milestone | Metric | Owner |
|-----------|--------|-------|
| Launch SSO/SAML | 5 enterprise logos | Eng |
| Self-serve onboarding | Setup time < 10 min | Product |
| SOC 2 Type I | Certification obtained | CEO |
| Free trial funnel | 500 trial starts/mo | Growth |

- **Dependencies**: SOC 2 auditor engaged (Week 1), SSO provider selected
- **Risks**: SOC 2 could take 4 months, not 3. Mitigation: use Vanta to accelerate
- **Resources**: +1 DevOps engineer, +1 Security consultant (contract)
- **Success**: 100 companies, $400K ARR, < 5% monthly churn

---

**Phase 2 — Growth** (Months 3-6)
**Theme**: Scale acquisition and prove unit economics

| Milestone | Metric | Owner |
|-----------|--------|-------|
| Launch integrations | GitHub, Jira, Slack live | Eng |
| Partner program | 5 staffing agencies signed | Sales |
| Content engine | 50 technical blog posts, 10 case studies | Growth |
| Expansion revenue | 20% of revenue from upsells | Sales |

- **Dependencies**: Phase 1 milestones complete, content budget approved
- **Risks**: Hiring agencies may not convert well. Mitigation: start with 2 agencies, measure 90 days
- **Resources**: +2 engineers, +1 content writer, +1 sales rep
- **Success**: 250 companies, $1M ARR, LTV:CAC > 5

---

**Phase 3 — Expansion** (Months 6-12)
**Theme**: New segments and product lines

| Milestone | Metric | Owner |
|-----------|--------|-------|
| Launch product teams | 50 companies using team features | Product |
| International | UK/EU launch, 30 international companies | Sales |
| Marketplace | 50+ assessment templates available | Eng |
| API platform | 10 external integrations built by partners | DevRel |

- **Dependencies**: Legal review for EU data handling, localization budget
- **Risks**: EU GDPR compliance is expensive. Mitigation: use US-only data initially, expand cautiously
- **Resources**: +4 engineers, +2 sales (EMEA), +1 legal
- **Success**: 500 companies, $2M ARR, path to profitability

---

**Key Metrics Dashboard**:
| Metric | Now | Month 3 | Month 6 | Month 12 |
|--------|-----|---------|---------|----------|
| Companies | 50 | 100 | 250 | 500 |
| ARR | $200K | $400K | $1M | $2M |
| MoM Growth | 18% | 15% | 12% | 8% |
| Monthly Churn | 8% | 5% | 4% | 3% |
| Team Size | 6 | 10 | 15 | 22 |
