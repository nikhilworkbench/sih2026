require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");

const app = express();

const PORT = process.env.PORT || 5000;

// =====================================================
// POSTGRESQL
// =====================================================

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,

    ssl:
        process.env.NODE_ENV === "production"
            ? { rejectUnauthorized: false }
            : false
});


// =====================================================
// EXPRESS
// =====================================================

app.use(express.json());

app.use(
    express.urlencoded({
        extended: true
    })
);

app.use(
    express.static(__dirname)
);


// =====================================================
// WHATSAPP DEMO CONFIGURATION
// =====================================================

/*
 * SIH DEMO MODE
 *
 * No WhatsApp API
 * No access token
 * No Meta App
 * No QR code
 * No WhatsApp Web session
 *
 * Messages are stored in PostgreSQL and their
 * delivery status is simulated.
 */

const WHATSAPP_MODE = "demo";


// =====================================================
// PHONE NORMALIZATION
// =====================================================

function normalizePhone(phone) {

    let clean =
        String(phone || "")
            .replace(/\D/g, "");

    // Indian 10 digit number
    if (clean.length === 10) {
        clean = "91" + clean;
    }

    if (!/^91\d{10}$/.test(clean)) {

        throw new Error(
            "Invalid Indian mobile number. Use 10 digits or 919876543210."
        );
    }

    return clean;
}


// =====================================================
// DEMO MESSAGE TEXT
// =====================================================

function createSurveyMessage({
    name,
    course,
    sector
}) {

    return `Namaskar ${name || "Trainee"}!

Greetings from KaushalSetu Maharashtra Skill Mission.

You completed the ${course || "Skill Training"} course in the ${sector || "Technical"} sector.

Please update your current employment status:

1. Salaried Job - Company name & monthly salary
2. Self-Employed - Shop / Venture details
3. Still Searching - Need placement assistance

Your response helps update your skill training outcome record.

Thank you,
KaushalSetu Maharashtra`;

}


// =====================================================
// CREATE WHATSAPP DEMO TABLE
// =====================================================

async function ensureWhatsAppTables() {

    await pool.query(`

        CREATE TABLE IF NOT EXISTS whatsapp_messages (

            id SERIAL PRIMARY KEY,

            phone VARCHAR(20) NOT NULL,

            trainee_id INTEGER,

            trainee_name VARCHAR(255),

            course VARCHAR(255),

            sector VARCHAR(255),

            message TEXT NOT NULL,

            status VARCHAR(50) NOT NULL DEFAULT 'queued',

            demo_mode BOOLEAN NOT NULL DEFAULT TRUE,

            message_id VARCHAR(255),

            created_at TIMESTAMP DEFAULT NOW(),

            sent_at TIMESTAMP,

            delivered_at TIMESTAMP,

            error TEXT

        );

    `);


    await pool.query(`

        CREATE INDEX IF NOT EXISTS
        idx_whatsapp_messages_phone

        ON whatsapp_messages(phone);

    `);


    await pool.query(`

        CREATE INDEX IF NOT EXISTS
        idx_whatsapp_messages_status

        ON whatsapp_messages(status);

    `);

}


// =====================================================
// CREATE / VERIFY OUTCOME TABLE
// =====================================================

async function ensureOutcomeTable() {

    /*
     * Your existing schema normally creates this table.
     *
     * This fallback ensures the SIH demo does not crash
     * if outcome_responses was not included in schema.sql.
     */

    await pool.query(`

        CREATE TABLE IF NOT EXISTS outcome_responses (

            id SERIAL PRIMARY KEY,

            trainee_id INTEGER,

            phone VARCHAR(20),

            response_text TEXT,

            employment_status VARCHAR(100),

            source VARCHAR(100),

            verified BOOLEAN DEFAULT FALSE,

            created_at TIMESTAMP DEFAULT NOW()

        );

    `);

}


// =====================================================
// DATABASE INITIALIZATION
// =====================================================

async function initializeDatabase() {

    try {

        const schemaPath =
            path.join(
                __dirname,
                "schema.sql"
            );


        if (fs.existsSync(schemaPath)) {

            const schema =
                fs.readFileSync(
                    schemaPath,
                    "utf8"
                );

            if (schema.trim()) {

                await pool.query(schema);

                console.log(
                    "schema.sql executed successfully."
                );

            }

        }

        else {

            console.log(
                "schema.sql not found. Continuing with existing database."
            );

        }


        await ensureWhatsAppTables();

        await ensureOutcomeTable();


        console.log(
            "WhatsApp demo tables ready."
        );

    }

    catch (error) {

        console.error(
            "Database initialization error:",
            error.message
        );

    }

}


// =====================================================
// HOME
// =====================================================

app.get(
    "/",
    (req, res) => {

        res.sendFile(
            path.join(
                __dirname,
                "index.html"
            )
        );

    }
);


// =====================================================
// HEALTH
// =====================================================

app.get(
    "/api/health",
    async (req, res) => {

        let database = false;

        try {

            await pool.query(
                "SELECT 1"
            );

            database = true;

        }

        catch (error) {

            database = false;

        }


        res.json({

            success: true,

            server:
                "SkillTrack",

            databaseConfigured:
                Boolean(
                    process.env.DATABASE_URL
                ),

            databaseConnected:
                database,

            whatsappMode:
                WHATSAPP_MODE,

            whatsappApiRequired:
                false,

            message:
                "SIH WhatsApp Demo Mode is active."

        });

    }
);


// =====================================================
// DATABASE TEST
// =====================================================

app.get(
    "/api/db-test",
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    "SELECT NOW() AS current_time"
                );


            res.json({

                success: true,

                message:
                    "PostgreSQL connected successfully.",

                time:
                    result.rows[0].current_time

            });

        }

        catch (error) {

            console.error(
                "Database test failed:",
                error
            );


            res.status(500).json({

                success: false,

                message:
                    "Database connection failed.",

                error:
                    error.message

            });

        }

    }
);


// =====================================================
// TABLE TEST
// =====================================================

app.get(
    "/api/tables-test",
    async (req, res) => {

        try {

            const result =
                await pool.query(`

                    SELECT table_name

                    FROM information_schema.tables

                    WHERE table_schema = 'public'

                    ORDER BY table_name;

                `);


            res.json({

                success: true,

                tables:
                    result.rows.map(
                        row =>
                            row.table_name
                    )

            });

        }

        catch (error) {

            res.status(500).json({

                success: false,

                error:
                    error.message

            });

        }

    }
);


// =====================================================
// WHATSAPP STATUS
// =====================================================

app.get(
    "/api/whatsapp-status",
    async (req, res) => {

        try {

            const result =
                await pool.query(`

                    SELECT

                        COUNT(*)::int AS total,

                        COUNT(*)
                        FILTER (
                            WHERE status = 'queued'
                        )::int AS queued,

                        COUNT(*)
                        FILTER (
                            WHERE status = 'sent'
                        )::int AS sent,

                        COUNT(*)
                        FILTER (
                            WHERE status = 'delivered'
                        )::int AS delivered

                    FROM whatsapp_messages

                `);


            const stats =
                result.rows[0];


            res.json({

                success: true,

                mode:
                    "demo",

                connected:
                    true,

                status:
                    "demo_ready",

                realWhatsApp:
                    false,

                apiRequired:
                    false,

                statistics: {

                    total:
                        stats.total,

                    queued:
                        stats.queued,

                    sent:
                        stats.sent,

                    delivered:
                        stats.delivered

                },

                message:
                    "WhatsApp automation is running in SIH Demo Mode."

            });

        }

        catch (error) {

            console.error(
                "WhatsApp status error:",
                error
            );


            res.status(500).json({

                success: false,

                error:
                    error.message

            });

        }

    }
);


// =====================================================
// SEND SURVEY - SIH DEMO
// =====================================================

app.post(
    "/api/send-survey",
    async (req, res) => {

        try {

            const {
                name,
                phone,
                course,
                sector
            } = req.body;


            // ---------------------------------------------
            // VALIDATION
            // ---------------------------------------------

            if (!name) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Trainee name is required."

                });

            }


            if (!phone) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Trainee phone number is required."

                });

            }


            const cleanPhone =
                normalizePhone(phone);


            // ---------------------------------------------
            // FIND TRAINEE
            // ---------------------------------------------

            let traineeId = null;


            try {

                const traineeResult =
                    await pool.query(
                        `
                        SELECT id
                        FROM trainees
                        WHERE phone = $1
                        LIMIT 1
                        `,
                        [cleanPhone]
                    );


                if (
                    traineeResult.rows.length
                ) {

                    traineeId =
                        traineeResult.rows[0].id;

                }

            }

            catch (lookupError) {

                console.warn(
                    "Trainee lookup skipped:",
                    lookupError.message
                );

            }


            // ---------------------------------------------
            // MESSAGE
            // ---------------------------------------------

            const message =
                createSurveyMessage({

                    name,

                    course:
                        course ||
                        "Skill Training",

                    sector:
                        sector ||
                        "Technical"

                });


            // ---------------------------------------------
            // UNIQUE DEMO MESSAGE ID
            // ---------------------------------------------

            const messageId =
                "WA-DEMO-" +
                Date.now() +
                "-" +
                Math.floor(
                    Math.random() * 10000
                );


            // ---------------------------------------------
            // INSERT QUEUED MESSAGE
            // ---------------------------------------------

            const insertResult =
                await pool.query(
                    `
                    INSERT INTO whatsapp_messages
                    (
                        phone,
                        trainee_id,
                        trainee_name,
                        course,
                        sector,
                        message,
                        status,
                        demo_mode,
                        message_id
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        $4,
                        $5,
                        $6,
                        'queued',
                        TRUE,
                        $7
                    )
                    RETURNING id, created_at
                    `,
                    [
                        cleanPhone,
                        traineeId,
                        name,
                        course ||
                            "Skill Training",
                        sector ||
                            "Technical",
                        message,
                        messageId
                    ]
                );


            const databaseMessage =
                insertResult.rows[0];


            console.log(
                `[WhatsApp Demo] Message queued for ${cleanPhone}`
            );


            // ---------------------------------------------
            // SIMULATED DELIVERY
            // ---------------------------------------------

            /*
             * We intentionally simulate the lifecycle.
             *
             * queued
             *   ↓
             * sent
             *   ↓
             * delivered
             *
             * NO actual WhatsApp message is sent.
             */

            setTimeout(
                async () => {

                    try {

                        await pool.query(
                            `
                            UPDATE whatsapp_messages

                            SET

                                status = 'sent',

                                sent_at = NOW()

                            WHERE id = $1

                            AND status = 'queued'
                            `,
                            [
                                databaseMessage.id
                            ]
                        );


                        console.log(
                            `[WhatsApp Demo] SENT ${messageId}`
                        );


                    }

                    catch (error) {

                        console.error(
                            "Demo sent-status update failed:",
                            error.message
                        );

                    }

                },
                1500
            );


            setTimeout(
                async () => {

                    try {

                        await pool.query(
                            `
                            UPDATE whatsapp_messages

                            SET

                                status = 'delivered',

                                delivered_at = NOW()

                            WHERE id = $1

                            AND status = 'sent'
                            `,
                            [
                                databaseMessage.id
                            ]
                        );


                        console.log(
                            `[WhatsApp Demo] DELIVERED ${messageId}`
                        );


                    }

                    catch (error) {

                        console.error(
                            "Demo delivered-status update failed:",
                            error.message
                        );

                    }

                },
                4000
            );


            // ---------------------------------------------
            // RETURN SUCCESS
            // ---------------------------------------------

            return res.json({

                success: true,

                demo: true,

                mode:
                    "SIH Demo Mode",

                message:
                    "WhatsApp survey queued successfully in the demo system.",

                messageId,

                databaseId:
                    databaseMessage.id,

                phone:
                    cleanPhone,

                status:
                    "queued",

                note:
                    "No real WhatsApp message was sent. Delivery is simulated for the SIH demonstration."

            });

        }

        catch (error) {

            console.error(
                "Send survey error:",
                error
            );


            return res.status(500).json({

                success: false,

                error:
                    error.message

            });

        }

    }
);


// =====================================================
// WHATSAPP MESSAGE HISTORY
// =====================================================

app.get(
    "/api/whatsapp-messages",
    async (req, res) => {

        try {

            const limit =
                Math.min(
                    Number(
                        req.query.limit || 50
                    ),
                    200
                );


            const result =
                await pool.query(
                    `
                    SELECT

                        id,

                        phone,

                        trainee_name,

                        course,

                        sector,

                        status,

                        demo_mode,

                        message_id,

                        created_at,

                        sent_at,

                        delivered_at

                    FROM whatsapp_messages

                    ORDER BY created_at DESC

                    LIMIT $1
                    `,
                    [limit]
                );


            res.json({

                success: true,

                mode:
                    "demo",

                messages:
                    result.rows

            });

        }

        catch (error) {

            console.error(
                "WhatsApp message history error:",
                error
            );


            res.status(500).json({

                success: false,

                error:
                    error.message

            });

        }

    }
);


// =====================================================
// GET RESPONSES
// =====================================================

app.get(
    "/api/responses",
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT

                        id,

                        phone,

                        response_text AS text,

                        employment_status,

                        verified,

                        source,

                        created_at

                    FROM outcome_responses

                    ORDER BY created_at DESC

                    LIMIT 100
                    `
                );


            const responses =
                result.rows.map(
                    row => ({

                        id:
                            `db_${row.id}`,

                        phone:
                            row.phone,

                        text:
                            row.text,

                        timestamp:
                            new Date(
                                row.created_at
                            )
                                .toLocaleTimeString(
                                    [],
                                    {
                                        hour:
                                            "2-digit",
                                        minute:
                                            "2-digit"
                                    }
                                ),

                        verified:
                            Boolean(
                                row.verified
                            ),

                        employmentStatus:
                            row.employment_status,

                        source:
                            row.source

                    })
                );


            res.json(
                responses
            );

        }

        catch (error) {

            console.error(
                "Responses API error:",
                error
            );


            /*
             * Return an empty array rather than
             * breaking the frontend demo.
             */

            res.json([]);

        }

    }
);


// =====================================================
// DEMO RESPONSE API
// =====================================================

app.post(
    "/api/demo-response",
    async (req, res) => {

        try {

            const {
                phone,
                text,
                employmentStatus,
                verified
            } = req.body;


            if (!phone) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Phone number is required."

                });

            }


            if (!text) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Response text is required."

                });

            }


            const cleanPhone =
                normalizePhone(phone);


            let traineeId = null;


            try {

                const traineeResult =
                    await pool.query(
                        `
                        SELECT id
                        FROM trainees
                        WHERE phone = $1
                        LIMIT 1
                        `,
                        [cleanPhone]
                    );


                if (
                    traineeResult.rows.length
                ) {

                    traineeId =
                        traineeResult.rows[0].id;

                }

            }

            catch (error) {

                console.warn(
                    "Demo trainee lookup failed:",
                    error.message
                );

            }


            const status =
                employmentStatus ||
                (
                    /self[- ]?employed|business|shop|venture/i
                        .test(text)

                        ? "Self-Employed"

                        : /looking|unemployed|job search|placement assistance|not working/i
                            .test(text)

                            ? "Looking for Placement Assistance"

                            : /employed|working|job|placed|salary|joined|company|₹|rs\b/i
                                .test(text)

                                ? "Employed"

                                : "Unknown"
                );


            const isVerified =
                typeof verified === "boolean"
                    ? verified
                    : (
                        status === "Employed" ||
                        status === "Self-Employed"
                    );


            const result =
                await pool.query(
                    `
                    INSERT INTO outcome_responses
                    (
                        trainee_id,
                        phone,
                        response_text,
                        employment_status,
                        source,
                        verified
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        $4,
                        'WhatsApp Demo',
                        $5
                    )
                    RETURNING id, created_at
                    `,
                    [
                        traineeId,
                        cleanPhone,
                        text,
                        status,
                        isVerified
                    ]
                );


            const row =
                result.rows[0];


            res.json({

                success: true,

                response: {

                    id:
                        `db_${row.id}`,

                    phone:
                        cleanPhone,

                    text,

                    timestamp:
                        new Date(
                            row.created_at
                        )
                            .toLocaleTimeString(
                                [],
                                {
                                    hour:
                                        "2-digit",
                                    minute:
                                        "2-digit"
                                }
                            ),

                    verified:
                        isVerified,

                    employmentStatus:
                        status,

                    source:
                        "WhatsApp Demo"

                }

            });

        }

        catch (error) {

            console.error(
                "Demo response error:",
                error
            );


            res.status(500).json({

                success: false,

                error:
                    error.message

            });

        }

    }
);


// =====================================================
// GOVERNMENT METRICS
// =====================================================

app.get(
    "/api/government-metrics",
    async (req, res) => {

        try {

            const district =
                req.query.district ||
                "All Maharashtra";

            const scheme =
                req.query.scheme ||
                "All Schemes";


            let traineeWhere =
                "";

            let enrollmentWhere =
                "";

            const traineeParams =
                [];

            const enrollmentParams =
                [];


            // ---------------------------------------------
            // DISTRICT FILTER
            // ---------------------------------------------

            if (
                district !==
                "All Maharashtra"
            ) {

                traineeParams.push(
                    district
                );

                traineeWhere =
                    `WHERE district = $${traineeParams.length}`;


                enrollmentParams.push(
                    district
                );

                enrollmentWhere = `

                    WHERE trainee_id IN (

                        SELECT id

                        FROM trainees

                        WHERE district = $${enrollmentParams.length}

                    )

                `;

            }


            // ---------------------------------------------
            // SCHEME FILTER
            // ---------------------------------------------

            if (
                scheme !==
                "All Schemes"
            ) {

                enrollmentParams.push(
                    scheme
                );


                enrollmentWhere +=

                    enrollmentWhere
                        ? " AND "
                        : " WHERE ";


                enrollmentWhere +=
                    `scheme = $${enrollmentParams.length}`;

            }


            // ---------------------------------------------
            // TOTAL TRAINEES
            // ---------------------------------------------

            const traineeResult =
                await pool.query(
                    `
                    SELECT
                        COUNT(*)::int AS total

                    FROM trainees

                    ${traineeWhere}
                    `,
                    traineeParams
                );


            // ---------------------------------------------
            // EMPLOYMENT
            // ---------------------------------------------

            const employmentResult =
                await pool.query(
                    `
                    SELECT

                        COUNT(*)
                        FILTER (
                            WHERE e.status = 'Employed'
                        )::int AS employed,

                        COALESCE(

                            AVG(e.salary)
                            FILTER (
                                WHERE e.salary IS NOT NULL
                            ),

                            0

                        )::numeric AS avg_salary

                    FROM employment e

                    JOIN trainees t
                        ON t.id = e.trainee_id

                    ${
                        district !==
                        "All Maharashtra"

                            ? "WHERE t.district = $1"

                            : ""
                    }
                    `,

                    district !==
                    "All Maharashtra"

                        ? [district]

                        : []
                );


            // ---------------------------------------------
            // VERIFICATION SOURCES
            // ---------------------------------------------

            const verificationResult =
                await pool.query(
                    `
                    SELECT

                        verification_source,

                        COUNT(*)::int AS count

                    FROM employment e

                    JOIN trainees t
                        ON t.id = e.trainee_id

                    ${
                        district !==
                        "All Maharashtra"

                            ? "WHERE t.district = $1"

                            : ""
                    }

                    GROUP BY
                        verification_source

                    ORDER BY
                        count DESC
                    `,

                    district !==
                    "All Maharashtra"

                        ? [district]

                        : []
                );


            // ---------------------------------------------
            // JOB DEMAND
            // ---------------------------------------------

            const demandResult =
                await pool.query(
                    `
                    SELECT

                        sector,

                        SUM(openings)::int AS demand

                    FROM job_demand

                    ${
                        district !==
                        "All Maharashtra"

                            ? "WHERE district = $1"

                            : ""
                    }

                    GROUP BY
                        sector

                    ORDER BY
                        demand DESC
                    `,

                    district !==
                    "All Maharashtra"

                        ? [district]

                        : []
                );


            // ---------------------------------------------
            // SKILL SUPPLY
            // ---------------------------------------------

            const supplyResult =
                await pool.query(
                    `
                    SELECT

                        c.sector,

                        COUNT(*)::int AS supply

                    FROM enrollments e

                    JOIN courses c
                        ON c.id = e.course_id

                    JOIN trainees t
                        ON t.id = e.trainee_id

                    ${enrollmentWhere}

                    GROUP BY
                        c.sector

                    ORDER BY
                        supply DESC
                    `,
                    enrollmentParams
                );


            const total =
                Number(
                    traineeResult.rows[0]?.total ||
                    0
                );


            const employed =
                Number(
                    employmentResult.rows[0]?.employed ||
                    0
                );


            const avgSalary =
                Math.round(
                    Number(
                        employmentResult.rows[0]?.avg_salary ||
                        0
                    )
                );


            const placementRate =
                total > 0

                    ? Number(
                        (
                            employed /
                            total *
                            100
                        ).toFixed(1)
                    )

                    : 0;


            res.json({

                success: true,

                metrics: {

                    total,

                    placementRate,

                    avgSalary,

                    skillScore:
                        74

                },

                verification:
                    verificationResult.rows.map(
                        row => ({

                            source:
                                row.verification_source,

                            count:
                                Number(
                                    row.count
                                )

                        })
                    ),

                demand:
                    demandResult.rows.map(
                        row => ({

                            sector:
                                row.sector,

                            demand:
                                Number(
                                    row.demand
                                )

                        })
                    ),

                supply:
                    supplyResult.rows.map(
                        row => ({

                            sector:
                                row.sector,

                            supply:
                                Number(
                                    row.supply
                                )

                        })
                    )

            });

        }

        catch (error) {

            console.error(
                "Government metrics error:",
                error
            );


            res.status(500).json({

                success: false,

                error:
                    error.message

            });

        }

    }
);


// =====================================================
// TRAINING PROVIDER
// =====================================================

app.get(
    "/api/training-provider",
    async (req, res) => {

        try {

            const centerId =
                req.query.center_id ||
                null;


            let whereClause =
                "";

            const params =
                [];


            if (centerId) {

                params.push(
                    centerId
                );

                whereClause =
                    "WHERE tc.center_id = $1";

            }


            const result =
                await pool.query(
                    `
                    SELECT

                        tc.center_id,

                        tc.name AS center_name,

                        tc.district,

                        c.course_id,

                        c.name AS course_name,

                        c.sector,

                        e.batch_id,

                        COUNT(
                            DISTINCT e.trainee_id
                        )::int AS enrolled,

                        COUNT(
                            DISTINCT e.trainee_id
                        )
                        FILTER (
                            WHERE emp.status = 'Employed'
                        )::int AS employed,

                        COUNT(
                            DISTINCT e.trainee_id
                        )
                        FILTER (
                            WHERE emp.verification_source = 'EPFO'
                        )::int AS epfo_verified,

                        COUNT(
                            DISTINCT e.trainee_id
                        )
                        FILTER (
                            WHERE emp.verification_source = 'WhatsApp'
                        )::int AS whatsapp_verified,

                        COALESCE(

                            AVG(emp.salary)
                            FILTER (
                                WHERE
                                    emp.salary IS NOT NULL
                                    AND emp.status = 'Employed'
                            ),

                            0

                        )::numeric AS avg_salary

                    FROM training_centers tc

                    LEFT JOIN enrollments e
                        ON e.center_id = tc.id

                    LEFT JOIN courses c
                        ON c.id = e.course_id

                    LEFT JOIN employment emp
                        ON emp.trainee_id = e.trainee_id

                    ${whereClause}

                    GROUP BY

                        tc.center_id,

                        tc.name,

                        tc.district,

                        c.course_id,

                        c.name,

                        c.sector,

                        e.batch_id

                    ORDER BY

                        tc.name,

                        c.name,

                        e.batch_id

                    `,
                    params
                );


            const batches =
                result.rows.map(
                    row => {

                        const enrolled =
                            Number(
                                row.enrolled ||
                                0
                            );


                        const employed =
                            Number(
                                row.employed ||
                                0
                            );


                        const placementRate =
                            enrolled > 0

                                ? Number(
                                    (
                                        employed /
                                        enrolled *
                                        100
                                    ).toFixed(1)
                                )

                                : 0;


                        return {

                            centerId:
                                row.center_id,

                            centerName:
                                row.center_name,

                            district:
                                row.district,

                            courseId:
                                row.course_id,

                            courseName:
                                row.course_name ||
                                "Unknown Course",

                            sector:
                                row.sector ||
                                "Unknown",

                            batchId:
                                row.batch_id ||
                                "Not Assigned",

                            enrolled,

                            employed,

                            placementRate,

                            epfoVerified:
                                Number(
                                    row.epfo_verified ||
                                    0
                                ),

                            whatsappVerified:
                                Number(
                                    row.whatsapp_verified ||
                                    0
                                ),

                            avgSalary:
                                Math.round(
                                    Number(
                                        row.avg_salary ||
                                        0
                                    )
                                )

                        };

                    }
                );


            // ---------------------------------------------
            // SUMMARY
            // ---------------------------------------------

            const totalEnrolled =
                batches.reduce(
                    (
                        sum,
                        batch
                    ) =>
                        sum +
                        batch.enrolled,
                    0
                );


            const totalEmployed =
                batches.reduce(
                    (
                        sum,
                        batch
                    ) =>
                        sum +
                        batch.employed,
                    0
                );


            const totalEpfo =
                batches.reduce(
                    (
                        sum,
                        batch
                    ) =>
                        sum +
                        batch.epfoVerified,
                    0
                );


            const totalWhatsapp =
                batches.reduce(
                    (
                        sum,
                        batch
                    ) =>
                        sum +
                        batch.whatsappVerified,
                    0
                );


            const placementRate =
                totalEnrolled > 0

                    ? Number(
                        (
                            totalEmployed /
                            totalEnrolled *
                            100
                        ).toFixed(1)
                    )

                    : 0;


            const weightedSalary =
                batches.reduce(
                    (
                        sum,
                        batch
                    ) =>
                        sum +
                        (
                            batch.avgSalary *
                            batch.employed
                        ),
                    0
                );


            const avgSalary =
                totalEmployed > 0

                    ? Math.round(
                        weightedSalary /
                        totalEmployed
                    )

                    : 0;


            res.json({

                success: true,

                summary: {

                    enrolled:
                        totalEnrolled,

                    employed:
                        totalEmployed,

                    placementRate,

                    avgSalary,

                    epfoVerified:
                        totalEpfo,

                    whatsappVerified:
                        totalWhatsapp

                },

                batches

            });

        }

        catch (error) {

            console.error(
                "Training provider error:",
                error
            );


            res.status(500).json({

                success: false,

                error:
                    error.message

            });

        }

    }
);


// =====================================================
// SEED DEMO DATA
// =====================================================

app.get(
    "/api/seed-demo",
    async (req, res) => {

        try {

            if (
                req.query.key !==
                "SKILLTRACK2026"
            ) {

                return res.status(403).json({

                    success: false,

                    error:
                        "Unauthorized"

                });

            }


            // ---------------------------------------------
            // TRAINING CENTERS
            // ---------------------------------------------

            const centers = [

                [
                    "MSSDS-PUN-001",
                    "Government ITI Aundh",
                    "Pune",
                    "Maharashtra",
                    "A"
                ],

                [
                    "MSSDS-PUN-002",
                    "Skill Development Centre Pune",
                    "Pune",
                    "Maharashtra",
                    "A"
                ],

                [
                    "MSSDS-NAG-001",
                    "Government Skill Centre Nagpur",
                    "Nagpur",
                    "Maharashtra",
                    "A"
                ],

                [
                    "MSSDS-THA-001",
                    "Skill Development Centre Thane",
                    "Thane",
                    "Maharashtra",
                    "B"
                ],

                [
                    "MSSDS-AUR-001",
                    "Government ITI Chhatrapati Sambhajinagar",
                    "Aurangabad",
                    "Maharashtra",
                    "A"
                ],

                [
                    "MSSDS-NAS-001",
                    "Skill Development Centre Nashik",
                    "Nashik",
                    "Maharashtra",
                    "B"
                ],

                [
                    "MSSDS-KOL-001",
                    "Government Skill Centre Kolhapur",
                    "Kolhapur",
                    "Maharashtra",
                    "B"
                ],

                [
                    "MSSDS-SOL-001",
                    "Skill Development Centre Solapur",
                    "Solapur",
                    "Maharashtra",
                    "B"
                ]

            ];


            for (
                const center
                of centers
            ) {

                await pool.query(
                    `
                    INSERT INTO training_centers
                    (
                        center_id,
                        name,
                        district,
                        state,
                        grade
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        $4,
                        $5
                    )

                    ON CONFLICT (
                        center_id
                    )
                    DO NOTHING
                    `,
                    center
                );

            }


            // ---------------------------------------------
            // COURSES
            // ---------------------------------------------

            const courses = [

                [
                    "CRS-001",
                    "Data Entry Operator",
                    "IT-ITeS",
                    3
                ],

                [
                    "CRS-002",
                    "Web Developer",
                    "IT-ITeS",
                    6
                ],

                [
                    "CRS-003",
                    "Electrician",
                    "Electrical",
                    6
                ],

                [
                    "CRS-004",
                    "Solar PV Installer",
                    "Green Jobs",
                    3
                ],

                [
                    "CRS-005",
                    "Automotive Service Technician",
                    "Automotive",
                    6
                ],

                [
                    "CRS-006",
                    "General Duty Assistant",
                    "Healthcare",
                    3
                ],

                [
                    "CRS-007",
                    "Retail Sales Associate",
                    "Retail",
                    3
                ],

                [
                    "CRS-008",
                    "CNC Machine Operator",
                    "Capital Goods",
                    6
                ],

                [
                    "CRS-009",
                    "Beauty Therapist",
                    "Beauty & Wellness",
                    3
                ],

                [
                    "CRS-010",
                    "Warehouse Associate",
                    "Logistics",
                    3
                ]

            ];


            for (
                const course
                of courses
            ) {

                await pool.query(
                    `
                    INSERT INTO courses
                    (
                        course_id,
                        name,
                        sector,
                        duration_months
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        $4
                    )

                    ON CONFLICT (
                        course_id
                    )
                    DO NOTHING
                    `,
                    course
                );

            }


            // ---------------------------------------------
            // TRAINEES
            // ---------------------------------------------

            const districts = [

                "Pune",
                "Nagpur",
                "Thane",
                "Aurangabad",
                "Nashik",
                "Kolhapur",
                "Solapur"

            ];


            const firstNames = [

                "Aarav",
                "Aditya",
                "Amit",
                "Anjali",
                "Ananya",
                "Arjun",
                "Akash",
                "Priya",
                "Rahul",
                "Riya",
                "Sneha",
                "Rohit",
                "Vikas",
                "Neha",
                "Pooja",
                "Karan",
                "Sakshi",
                "Vivek",
                "Nikhil",
                "Shreya"

            ];


            for (
                let i = 1;
                i <= 500;
                i++
            ) {

                const traineeId =
                    `MH-SKILL-${String(i).padStart(5, "0")}`;


                const name =
                    firstNames[
                        (i - 1) %
                        firstNames.length
                    ];


                const district =
                    districts[
                        (i - 1) %
                        districts.length
                    ];


                const phone =
                    `91${7000000000 + i}`;


                await pool.query(
                    `
                    INSERT INTO trainees
                    (
                        trainee_id,
                        name,
                        phone,
                        district,
                        registration_date
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        $4,
                        CURRENT_DATE -
                        (($5 % 365)::int)
                    )

                    ON CONFLICT (
                        trainee_id
                    )
                    DO NOTHING
                    `,
                    [
                        traineeId,
                        `${name} ${1000 + i}`,
                        phone,
                        district,
                        i
                    ]
                );

            }


            // ---------------------------------------------
            // ENROLLMENTS
            // ---------------------------------------------

            const schemes = [

                "PMKUVA",
                "PMKUVA",
                "PMKUVA",
                "PM-GKVK",
                "DPC",
                "ACKCK",
                "SANKALP",
                "PMKVY"

            ];


            for (
                let i = 1;
                i <= 500;
                i++
            ) {

                const traineeId =
                    `MH-SKILL-${String(i).padStart(5, "0")}`;


                const course =
                    courses[
                        (i - 1) %
                        courses.length
                    ];


                const center =
                    centers[
                        (i - 1) %
                        centers.length
                    ];


                const scheme =
                    schemes[
                        (i - 1) %
                        schemes.length
                    ];


                const status =
                    i % 10 === 0

                        ? "Enrolled"

                        : i % 7 === 0

                            ? "In Progress"

                            : "Completed";


                await pool.query(
                    `
                    INSERT INTO enrollments
                    (
                        trainee_id,
                        course_id,
                        center_id,
                        batch_id,
                        enrollment_date,
                        completion_date,
                        status,
                        scheme
                    )

                    SELECT

                        t.id,

                        c.id,

                        tc.id,

                        $1,

                        CURRENT_DATE -
                        (($2 % 300)::int),

                        CASE

                            WHEN $3 = 'Completed'

                            THEN CURRENT_DATE -
                            (($2 % 150)::int)

                            ELSE NULL

                        END,

                        $3,

                        $4

                    FROM trainees t

                    CROSS JOIN courses c

                    CROSS JOIN training_centers tc

                    WHERE

                        t.trainee_id = $5

                        AND c.course_id = $6

                        AND tc.center_id = $7

                    AND NOT EXISTS (

                        SELECT 1

                        FROM enrollments e

                        WHERE
                            e.trainee_id =
                            t.id

                    )
                    `,
                    [
                        `BATCH-${Math.floor(
                            (i - 1) / 25
                        ) + 1}`,

                        i,

                        status,

                        scheme,

                        traineeId,

                        course[0],

                        center[0]
                    ]
                );

            }


            // ---------------------------------------------
            // EMPLOYMENT
            // ---------------------------------------------

            const companies = [

                "TechServe Solutions",
                "Maharashtra AutoWorks",
                "Green Energy Services",
                "HealthCare Plus",
                "Digital Retail India",
                "Pune Industrial Systems",
                "LogiMove India"

            ];


            const roles = [

                "Junior Web Developer",
                "Data Entry Operator",
                "Automotive Technician",
                "Solar Technician",
                "Healthcare Assistant",
                "Retail Associate",
                "CNC Operator"

            ];


            const verificationSources = [

                "Employer",
                "WhatsApp",
                "EPFO",
                "Employer",
                "WhatsApp"

            ];


            for (
                let i = 1;
                i <= 500;
                i++
            ) {

                if (
                    i % 100 > 67
                ) {

                    continue;

                }


                const traineeId =
                    `MH-SKILL-${String(i).padStart(5, "0")}`;


                const salary =
                    10000 +
                    (
                        i * 137
                    ) %
                    18000;


                const company =
                    companies[
                        (i - 1) %
                        companies.length
                    ];


                const role =
                    roles[
                        (i - 1) %
                        roles.length
                    ];


                const source =
                    verificationSources[
                        (i - 1) %
                        verificationSources.length
                    ];


                await pool.query(
                    `
                    INSERT INTO employment
                    (
                        trainee_id,
                        status,
                        company,
                        role,
                        salary,
                        employment_date,
                        verification_source,
                        verified
                    )

                    SELECT

                        id,

                        'Employed',

                        $1,

                        $2,

                        $3,

                        CURRENT_DATE -
                        (($4 % 120)::int),

                        $5,

                        TRUE

                    FROM trainees

                    WHERE
                        trainee_id = $6

                    AND NOT EXISTS (

                        SELECT 1

                        FROM employment e

                        WHERE
                            e.trainee_id =
                            trainees.id

                    )
                    `,
                    [
                        company,
                        role,
                        salary,
                        i,
                        source,
                        traineeId
                    ]
                );

            }


            // ---------------------------------------------
            // JOB DEMAND
            // ---------------------------------------------

            const demands = [

                [
                    "Tata Auto Systems",
                    "Automotive Technician",
                    "Automotive",
                    180,
                    "Pune"
                ],

                [
                    "Tech Mahindra",
                    "Junior Web Developer",
                    "IT-ITeS",
                    250,
                    "Pune"
                ],

                [
                    "Infosys",
                    "Data Entry Operator",
                    "IT-ITeS",
                    140,
                    "Pune"
                ],

                [
                    "Adani Green",
                    "Solar Technician",
                    "Green Jobs",
                    220,
                    "Nagpur"
                ],

                [
                    "Apollo Partner Network",
                    "Healthcare Assistant",
                    "Healthcare",
                    160,
                    "Thane"
                ],

                [
                    "RetailMart India",
                    "Retail Associate",
                    "Retail",
                    190,
                    "Pune"
                ],

                [
                    "Industrial Solutions",
                    "CNC Operator",
                    "Capital Goods",
                    120,
                    "Aurangabad"
                ],

                [
                    "LogiMove India",
                    "Warehouse Associate",
                    "Logistics",
                    210,
                    "Nashik"
                ]

            ];


            for (
                const demand
                of demands
            ) {

                await pool.query(
                    `
                    INSERT INTO job_demand
                    (
                        company,
                        role,
                        sector,
                        openings,
                        district,
                        source
                    )

                    SELECT

                        $1,
                        $2,
                        $3,
                        $4,
                        $5,
                        'Demo job-market dataset'

                    WHERE NOT EXISTS (

                        SELECT 1

                        FROM job_demand

                        WHERE
                            company = $1

                        AND role = $2

                        AND district = $5

                    )
                    `,
                    demand
                );

            }


            // ---------------------------------------------
            // COUNTS
            // ---------------------------------------------

            const counts =
                await pool.query(
                    `
                    SELECT

                        (
                            SELECT COUNT(*)
                            FROM trainees
                        ) AS trainees,

                        (
                            SELECT COUNT(*)
                            FROM training_centers
                        ) AS training_centers,

                        (
                            SELECT COUNT(*)
                            FROM courses
                        ) AS courses,

                        (
                            SELECT COUNT(*)
                            FROM enrollments
                        ) AS enrollments,

                        (
                            SELECT COUNT(*)
                            FROM employment
                        ) AS employment,

                        (
                            SELECT COUNT(*)
                            FROM job_demand
                        ) AS job_demand
                    `
                );


            res.json({

                success: true,

                message:
                    "Synthetic SIH demo dataset inserted successfully.",

                warning:
                    "Individual trainee records are synthetic and must not be presented as actual government beneficiary records.",

                counts:
                    counts.rows[0]

            });

        }

        catch (error) {

            console.error(
                "Seed demo error:",
                error
            );


            res.status(500).json({

                success: false,

                error:
                    error.message

            });

        }

    }
);


// =====================================================
// 404
// =====================================================

app.use(
    (req, res) => {

        res.status(404).json({

            success: false,

            error:
                "API route not found."

        });

    }
);


// =====================================================
// GLOBAL ERROR HANDLER
// =====================================================

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        console.error(
            "Unhandled server error:",
            error
        );


        res.status(500).json({

            success: false,

            error:
                error.message ||
                "Internal server error."

        });

    }
);


// =====================================================
// START SERVER
// =====================================================

app.listen(
    PORT,
    async () => {

        console.log(
            "=============================================="
        );

        console.log(
            "SkillTrack / KaushalSetu SIH Backend"
        );

        console.log(
            `Server running on port ${PORT}`
        );

        console.log(
            "WhatsApp Mode: SIH DEMO"
        );

        console.log(
            "Real WhatsApp API: DISABLED"
        );

        console.log(
            "Access Token Required: NO"
        );

        console.log(
            "=============================================="
        );


        await initializeDatabase();

    }
);
