# Maker Architecture Template

## Purpose
System architecture and design decision documentation.

## Variables
- `{{project}}` — Project description
- `{{requirements}}` — Functional and non-functional requirements
- `{{scale}}` — Expected scale/users
- `{{constraints}}` — Budget, team size, timeline

## Response Structure

### 1. Architecture Overview
High-level description of the system with a text-based diagram.

### 2. Technology Choices
For each major choice, explain:
- What you chose and why
- What you considered but didn't choose
- When you'd reconsider

### 3. Data Model
Key entities and relationships.

### 4. API Design
Main endpoints and data flow.

### 5. Deployment Strategy
How this gets from dev to production.

### Example Diagram
```
┌──────────┐     ┌─────────────┐     ┌──────────┐
│  Client  │────▶│  API Gateway │────▶│  Service  │
│ (React)  │     │   (Next.js)  │     │   Layer   │
└──────────┘     └──────┬───────┘     └────┬─────┘
                        │                   │
                 ┌──────▼───────┐     ┌────▼─────┐
                 │   Auth/JWT   │     │  PostgreSQL│
                 │   (Clerk)    │     │  (Neon)   │
                 └──────────────┘     └──────────┘
                        │
                 ┌──────▼───────┐
                 │    Redis     │
                 │   (Upstash)  │
                 └──────────────┘
```

### Technology Choice Format
```
**Database: PostgreSQL (via Neon)**
- ✅ Chosen: ACID compliance, relational data fits our model, serverless tier for cheap start
- ❌ Not MongoDB: Our data is relational (users → projects → tasks), documents add complexity
- ❌ Not Supabase: Want to own the migration strategy, not depend on their SDK
- Reconsider if: We need real-time sync (Supabase) or document flexibility (MongoDB)
```
