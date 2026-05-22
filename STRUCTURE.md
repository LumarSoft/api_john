# Project Structure

```
api/
├── docs/                          # Project documentation
│   ├── endpoints.md               # API endpoint reference
│   └── rules/                     # Architecture and coding rules
│       ├── architecture.md
│       ├── commits.md
│       ├── database.md
│       ├── documentation.md
│       ├── error-handling.md
│       ├── naming.md
│       ├── security.md
│       └── validation.md
│
├── prisma/                        # Database layer
│   ├── migrations/                # Applied migration history
│   │   ├── 20260507234526_init/
│   │   └── 20260507235338_add_password_to_user/
│   └── schema.prisma              # Single source of truth for DB schema
│
├── src/                           # Application source code
│   ├── auth/                      # Authentication module
│   │   ├── dto/
│   │   │   ├── login.dto.ts
│   │   │   └── register.dto.ts
│   │   ├── auth.controller.ts     # POST /auth/register, POST /auth/login
│   │   ├── auth.module.ts
│   │   ├── auth.service.ts
│   │   ├── jwt-auth.guard.ts      # Guard for protected routes
│   │   ├── jwt.strategy.ts        # Passport JWT strategy
│   │   └── optional-jwt-auth.guard.ts  # Guard for optionally authenticated routes
│   │
│   ├── cotizador/                 # Auto insurance quotation module
│   │   ├── dto/
│   │   │   └── cotizar-auto.dto.ts
│   │   ├── cotizador.controller.ts  # POST /cotizador/auto
│   │   ├── cotizador.module.ts
│   │   └── cotizador.service.ts
│   │
│   ├── infoauto/                  # InfoAuto external API integration
│   │   ├── dto/
│   │   │   ├── infoauto-query.dto.ts   # Shared query params (query_string, page, page_size)
│   │   │   ├── brand-id-param.dto.ts   # :brandId path param
│   │   │   └── group-params.dto.ts     # :brandId + :groupId path params
│   │   ├── infoauto.controller.ts  # GET /infoauto/brands, /groups, /models
│   │   ├── infoauto.module.ts
│   │   └── infoauto.service.ts
│   │
│   ├── triunfo/                   # Triunfo external API integration
│   │   ├── triunfo.module.ts
│   │   └── triunfo.service.ts     # Token caching + auth for Triunfo API
│   │
│   ├── prisma/                    # Global database module
│   │   ├── prisma.module.ts
│   │   └── prisma.service.ts
│   │
│   ├── app.controller.ts          # GET / (health check)
│   ├── app.module.ts              # Root module
│   ├── app.service.ts
│   └── main.ts                    # Bootstrap — port, global pipes
│
├── test/                          # End-to-end tests
│   ├── app.e2e-spec.ts
│   └── jest-e2e.json
│
├── .husky/                        # Git hooks
│   └── pre-commit
│
├── CLAUDE.md                      # Claude Code guidance
├── STRUCTURE.md                   # This file
├── nest-cli.json
├── package.json
├── prisma.config.ts
├── tsconfig.json
└── tsconfig.build.json
```

## Module overview

| Module          | Path               | Responsibility                                      |
|-----------------|--------------------|-----------------------------------------------------|
| AppModule       | `src/`             | Root module, wires everything together              |
| AuthModule      | `src/auth/`        | Registration, login, JWT strategy/guard             |
| CotizadorModule | `src/cotizador/`   | Auto insurance quotations via Triunfo API           |
| InfoAutoModule  | `src/infoauto/`    | InfoAuto API client — brands, groups, models        |
| TriunfoModule   | `src/triunfo/`     | Triunfo external API client — token caching + auth  |
| PrismaModule    | `src/prisma/`      | Global DB access via PrismaService                  |
