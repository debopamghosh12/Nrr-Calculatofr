// server.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs/promises');
const { Pool } = require('pg');

const app = express();
const PORT = 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin123';
const ADMIN_ID = process.env.ADMIN_ID || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || ADMIN_KEY;
const DATABASE_URL = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const adminSessions = new Map();
const dbPool = DATABASE_URL
    ? new Pool({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    })
    : null;

// Middleware to parse JSON and allow cross-origin requests from our HTML file
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname)));

app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (_req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/nrr', (_req, res) => {
    res.sendFile(path.join(__dirname, 'nrr.html'));
});

app.get('/points', (_req, res) => {
    res.sendFile(path.join(__dirname, 'points.html'));
});

const tournamentData = {
    tournamentName: 'Hostel Premier League 2026',
    badgeText: 'LIVE',
    description: 'Track fixtures and estimate your NRR impact match-by-match.',
    fixtures: [
        { teamA: 'Belgium', teamB: 'Malta', state: 'Today' },
        { teamA: 'Portugal', teamB: 'Malta', state: 'Live' }
    ],
    results: [
        { summary: 'India 228-5', outcome: 'Won' },
        { summary: 'Australia 206-8', outcome: 'Lost' }
    ],
    stats: [
        { label: 'Teams', value: '8' },
        { label: 'Matches', value: '24' },
        { label: 'Live Now', value: '1' }
    ]
};

// Helper function to calculate exact decimal overs (e.g., 19 overs, 3 balls = 19.5 overs)
const calculateOvers = (overs, balls) => {
    return overs + (balls / 6);
};

const calculateTotalBalls = (overs, balls) => {
    return (overs * 6) + balls;
};

const queryDb = async (queryText, params = []) => {
    if (!dbPool) {
        throw new Error('Neon database is not configured. Set DATABASE_URL.');
    }
    return dbPool.query(queryText, params);
};

const initializeDatabase = async () => {
    if (!dbPool) {
        return;
    }

    const schemaPath = path.join(__dirname, 'db', 'neon_schema.sql');
    const schemaSql = await fs.readFile(schemaPath, 'utf8');
    await queryDb(schemaSql);
    console.log('Neon schema initialized from db/neon_schema.sql');
};

// Helper function to calculate individual match NRR
const calculateMatchNRR = (batting, bowling, runRateBasis = 'overs') => {
    const batOvers = calculateOvers(batting.overs, batting.balls);
    const bowlOvers = calculateOvers(bowling.overs, bowling.balls);
    const batBalls = calculateTotalBalls(batting.overs, batting.balls);
    const bowlBalls = calculateTotalBalls(bowling.overs, bowling.balls);

    const runRateFor = runRateBasis === 'balls'
        ? (batBalls > 0 ? (batting.runs / batBalls) : 0)
        : (batOvers > 0 ? (batting.runs / batOvers) : 0);

    const runRateAgainst = runRateBasis === 'balls'
        ? (bowlBalls > 0 ? (bowling.runs / bowlBalls) : 0)
        : (bowlOvers > 0 ? (bowling.runs / bowlOvers) : 0);

    return runRateFor - runRateAgainst;
};

const generateAdminToken = () => {
    const token = crypto.randomBytes(24).toString('hex');
    adminSessions.set(token, Date.now() + SESSION_TTL_MS);
    return token;
};

const isValidAdminToken = (token) => {
    if (!token || !adminSessions.has(token)) {
        return false;
    }

    const expiresAt = adminSessions.get(token);
    if (Date.now() > expiresAt) {
        adminSessions.delete(token);
        return false;
    }

    return true;
};

app.post('/api/admin-login', (req, res) => {
    const { adminId, adminPass } = req.body || {};

    if (adminId !== ADMIN_ID || adminPass !== ADMIN_PASS) {
        return res.status(401).json({ error: 'Invalid admin credentials.' });
    }

    const token = generateAdminToken();
    return res.json({ token, expiresInMs: SESSION_TTL_MS });
});

app.get('/api/tournament-data', (_req, res) => {
    res.json(tournamentData);
});

app.put('/api/tournament-data', (req, res) => {
    const { adminToken, tournamentName, badgeText, description, fixtures, results, stats } = req.body || {};

    if (!isValidAdminToken(adminToken)) {
        return res.status(401).json({ error: 'Unauthorized admin session.' });
    }

    tournamentData.tournamentName = typeof tournamentName === 'string' && tournamentName.trim()
        ? tournamentName.trim()
        : tournamentData.tournamentName;

    tournamentData.badgeText = typeof badgeText === 'string' && badgeText.trim()
        ? badgeText.trim()
        : tournamentData.badgeText;

    tournamentData.description = typeof description === 'string' && description.trim()
        ? description.trim()
        : tournamentData.description;

    if (Array.isArray(fixtures)) {
        tournamentData.fixtures = fixtures
            .filter((item) => item && item.teamA && item.teamB)
            .map((item) => ({
                teamA: String(item.teamA).trim(),
                teamB: String(item.teamB).trim(),
                state: String(item.state || 'Scheduled').trim()
            }));
    }

    if (Array.isArray(results)) {
        tournamentData.results = results
            .filter((item) => item && item.summary)
            .map((item) => ({
                summary: String(item.summary).trim(),
                outcome: String(item.outcome || 'Finished').trim()
            }));
    }

    if (Array.isArray(stats)) {
        tournamentData.stats = stats
            .filter((item) => item && item.label)
            .map((item) => ({
                label: String(item.label).trim(),
                value: String(item.value || '0').trim()
            }));
    }

    res.json({ message: 'Tournament data updated.', data: tournamentData });
});

app.get('/api/db-status', async (_req, res) => {
    if (!dbPool) {
        return res.json({
            neonConfigured: false,
            connected: false,
            message: 'Set DATABASE_URL to enable Neon features.'
        });
    }

    try {
        await queryDb('SELECT 1 AS ok');
        return res.json({
            neonConfigured: true,
            connected: true,
            message: 'Neon database connected.'
        });
    } catch (error) {
        return res.status(500).json({
            neonConfigured: true,
            connected: false,
            message: `Neon connection failed: ${error.message}`
        });
    }
});

app.get('/api/points-table', async (_req, res) => {
    try {
        const result = await queryDb(`
            WITH team_stats AS (
                SELECT
                    t.id,
                    t.team_name,
                    COUNT(m.id) FILTER (WHERE m.id IS NOT NULL) AS played,
                    COUNT(m.id) FILTER (WHERE m.winner_team_id = t.id) AS wins,
                    COUNT(m.id) FILTER (WHERE m.match_result = 'tie') AS ties,
                    COUNT(m.id) FILTER (WHERE m.match_result = 'no_result') AS no_results,
                    COUNT(m.id) FILTER (
                        WHERE m.id IS NOT NULL
                          AND m.match_result = 'normal'
                          AND m.winner_team_id IS NOT NULL
                          AND m.winner_team_id <> t.id
                    ) AS losses,
                    COALESCE(SUM(
                        CASE
                            WHEN m.team_a_id = t.id THEN m.team_a_runs
                            WHEN m.team_b_id = t.id THEN m.team_b_runs
                            ELSE 0
                        END
                    ), 0) AS runs_for,
                    COALESCE(SUM(
                        CASE
                            WHEN m.team_a_id = t.id THEN (m.team_a_overs * 6 + m.team_a_balls)
                            WHEN m.team_b_id = t.id THEN (m.team_b_overs * 6 + m.team_b_balls)
                            ELSE 0
                        END
                    ), 0) AS balls_faced,
                    COALESCE(SUM(
                        CASE
                            WHEN m.team_a_id = t.id THEN m.team_b_runs
                            WHEN m.team_b_id = t.id THEN m.team_a_runs
                            ELSE 0
                        END
                    ), 0) AS runs_against,
                    COALESCE(SUM(
                        CASE
                            WHEN m.team_a_id = t.id THEN (m.team_b_overs * 6 + m.team_b_balls)
                            WHEN m.team_b_id = t.id THEN (m.team_a_overs * 6 + m.team_a_balls)
                            ELSE 0
                        END
                    ), 0) AS balls_bowled
                FROM teams t
                LEFT JOIN matches m ON m.team_a_id = t.id OR m.team_b_id = t.id
                GROUP BY t.id, t.team_name
            )
            SELECT
                id,
                team_name,
                played,
                wins,
                losses,
                ties,
                no_results,
                (wins * 2 + ties + no_results) AS points,
                runs_for,
                balls_faced,
                runs_against,
                balls_bowled,
                CASE
                    WHEN balls_faced > 0 AND balls_bowled > 0
                    THEN (runs_for::numeric / balls_faced) - (runs_against::numeric / balls_bowled)
                    ELSE 0
                END AS nrr_by_balls
            FROM team_stats
            ORDER BY points DESC, nrr_by_balls DESC, team_name ASC;
        `);

        res.json({
            basisUsed: 'balls',
            rows: result.rows
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/points-match', async (req, res) => {
    const {
        adminToken,
        teamAName,
        teamBName,
        teamARuns,
        teamAOvers,
        teamABalls,
        teamBRuns,
        teamBOvers,
        teamBBalls,
        resultType,
        winnerName,
        matchDate
    } = req.body || {};

    if (!isValidAdminToken(adminToken)) {
        return res.status(401).json({ error: 'Unauthorized admin session.' });
    }

    if (!teamAName || !teamBName) {
        return res.status(400).json({ error: 'Both team names are required.' });
    }

    if (teamAName === teamBName) {
        return res.status(400).json({ error: 'Team A and Team B must be different.' });
    }

    const safeResultType = ['normal', 'tie', 'no_result'].includes(resultType)
        ? resultType
        : 'normal';

    const client = dbPool ? await dbPool.connect() : null;

    try {
        if (!client) {
            throw new Error('Neon database is not configured. Set DATABASE_URL.');
        }

        await client.query('BEGIN');

        const teamAResult = await client.query(
            `
                INSERT INTO teams (team_name)
                VALUES ($1)
                ON CONFLICT (team_name) DO UPDATE SET team_name = EXCLUDED.team_name
                RETURNING id;
            `,
            [String(teamAName).trim()]
        );

        const teamBResult = await client.query(
            `
                INSERT INTO teams (team_name)
                VALUES ($1)
                ON CONFLICT (team_name) DO UPDATE SET team_name = EXCLUDED.team_name
                RETURNING id;
            `,
            [String(teamBName).trim()]
        );

        const teamAId = teamAResult.rows[0].id;
        const teamBId = teamBResult.rows[0].id;

        let winnerTeamId = null;
        if (safeResultType === 'normal') {
            if (winnerName && String(winnerName).trim() === String(teamAName).trim()) {
                winnerTeamId = teamAId;
            } else if (winnerName && String(winnerName).trim() === String(teamBName).trim()) {
                winnerTeamId = teamBId;
            } else {
                winnerTeamId = Number(teamARuns) >= Number(teamBRuns) ? teamAId : teamBId;
            }
        }

        const insertedMatch = await client.query(
            `
                INSERT INTO matches (
                    team_a_id,
                    team_b_id,
                    team_a_runs,
                    team_a_overs,
                    team_a_balls,
                    team_b_runs,
                    team_b_overs,
                    team_b_balls,
                    match_result,
                    winner_team_id,
                    match_date
                )
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                RETURNING id;
            `,
            [
                teamAId,
                teamBId,
                Number(teamARuns) || 0,
                Number(teamAOvers) || 0,
                Number(teamABalls) || 0,
                Number(teamBRuns) || 0,
                Number(teamBOvers) || 0,
                Number(teamBBalls) || 0,
                safeResultType,
                winnerTeamId,
                matchDate || null
            ]
        );

        await client.query('COMMIT');
        res.json({ message: 'Match stored in Neon.', matchId: insertedMatch.rows[0].id });
    } catch (error) {
        if (client) {
            await client.query('ROLLBACK');
        }
        res.status(500).json({ error: error.message });
    } finally {
        if (client) {
            client.release();
        }
    }
});

app.post('/api/calculate', (req, res) => {
    const { matches, runRateBasis } = req.body || {};

    if (!Array.isArray(matches)) {
        return res.status(400).json({ error: 'matches must be an array.' });
    }

    const safeBasis = runRateBasis === 'balls' ? 'balls' : 'overs';
    const safeMatches = matches.map((match) => ({
        batting: {
            runs: Number(match?.batting?.runs) || 0,
            overs: Number(match?.batting?.overs) || 0,
            balls: Math.min(5, Math.max(0, Number(match?.batting?.balls) || 0))
        },
        bowling: {
            runs: Number(match?.bowling?.runs) || 0,
            overs: Number(match?.bowling?.overs) || 0,
            balls: Math.min(5, Math.max(0, Number(match?.bowling?.balls) || 0))
        }
    }));

    const matchNRRs = safeMatches.map((match) => calculateMatchNRR(match.batting, match.bowling, safeBasis));
    const customSummedNRR = matchNRRs.reduce((sum, value) => sum + value, 0);

    return res.json({
        matchNRRs,
        customSummedNRR,
        officialCumulativeNRR: customSummedNRR
    });
});

const startServer = async () => {
    try {
        await initializeDatabase();
    } catch (error) {
        console.error(`Database initialization skipped/failed: ${error.message}`);
    }

    app.listen(PORT, () => {
        console.log(`NRR Calculator Backend running on http://localhost:${PORT}`);
    });
};

if (process.env.VERCEL) {
    initializeDatabase().catch((error) => {
        console.error(`Database initialization skipped/failed: ${error.message}`);
    });
}

if (require.main === module) {
    startServer();
}

module.exports = app;