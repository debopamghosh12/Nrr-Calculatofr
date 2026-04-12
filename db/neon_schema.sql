-- Neon PostgreSQL schema for points table and match ingestion
-- Run this in Neon SQL Editor before using /api/points-table and /api/points-match

CREATE TABLE IF NOT EXISTS teams (
    id BIGSERIAL PRIMARY KEY,
    team_name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS matches (
    id BIGSERIAL PRIMARY KEY,
    team_a_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    team_b_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    team_a_runs INTEGER NOT NULL DEFAULT 0,
    team_a_overs INTEGER NOT NULL DEFAULT 0,
    team_a_balls INTEGER NOT NULL DEFAULT 0 CHECK (team_a_balls BETWEEN 0 AND 5),
    team_b_runs INTEGER NOT NULL DEFAULT 0,
    team_b_overs INTEGER NOT NULL DEFAULT 0,
    team_b_balls INTEGER NOT NULL DEFAULT 0 CHECK (team_b_balls BETWEEN 0 AND 5),
    match_result TEXT NOT NULL DEFAULT 'normal' CHECK (match_result IN ('normal', 'tie', 'no_result')),
    winner_team_id BIGINT REFERENCES teams(id) ON DELETE RESTRICT,
    match_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (team_a_id <> team_b_id)
);

CREATE INDEX IF NOT EXISTS idx_matches_team_a ON matches(team_a_id);
CREATE INDEX IF NOT EXISTS idx_matches_team_b ON matches(team_b_id);
CREATE INDEX IF NOT EXISTS idx_matches_winner ON matches(winner_team_id);
CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(match_date);
