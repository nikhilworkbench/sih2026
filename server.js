require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");

const app = express();

const PORT = process.env.PORT || 5000;

// =====================================================
// POSTGRESQL DATABASE
// =====================================================

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false
});

// =====================================================
// WHATSAPP CLOUD API CONFIGURATION
// =====================================================

const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

const PHONE_NUMBER_ID =
    process.env.WHATSAPP_PHONE_NUMBER_ID;

const VERIFY_TOKEN =
    process.env.WHATSAPP_VERIFY_TOKEN;

const GRAPH_VERSION =
    process.env.WHATSAPP_GRAPH_VERSION || "v23.0";

const TEMPLATE_NAME =
    process.env.WHATSAPP_TEMPLATE_NAME ||
    "skilltrack_outcome_check";

const TEMPLATE_LANGUAGE =
    process.env.WHATSAPP_TEMPLATE_LANGUAGE ||
    "en";

const whatsappConfigured = Boolean(
    ACCESS_TOKEN && PHONE_NUMBER_ID
);

// =====================================================
// EXPRESS
// =====================================================

app.use(express.json());

app.use(express.urlencoded({
    extended: true
}));

app.use(express.static(
    path.join(__dirname)
));

// =====================================================
// PHONE NUMBER NORMALIZATION
// =====================================================

function normalizePhone(phone) {

    let cleanPhone =
        String(phone || "")
            .replace(/\D/g, "");

    // Indian 10 digit number
    if (cleanPhone.length === 10) {
        cleanPhone = "91" + cleanPhone;
    }

    if (!/^\d{10,15}$/.test(cleanPhone)) {
        throw new Error(
            "Invalid phone number. Use a 10-digit Indian number or international format."
        );
    }

    return cleanPhone;
}

// =====================================================
// SEND WHATSAPP TEMPLATE
// =====================================================

async function sendWhatsAppTemplate({
    phone,
    name,
    course,
    sector
}) {

    if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) {

        throw new Error(
            "WhatsApp Cloud API is not configured. Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in Render."
        );

    }

    const cleanPhone =
        normalizePhone(phone);

    const url =
        `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;

    const payload = {

        messaging_product: "whatsapp",

        to: cleanPhone,

        type: "template",

        template: {

            name: TEMPLATE_NAME,

            language: {
                code: TEMPLATE_LANGUAGE
            },

            components: [

                {
                    type: "body",

                    parameters: [

                        {
                            type: "text",
                            text: String(
                                name || "Trainee"
                            )
                        },

                        {
                            type: "text",
                            text: String(
                                course || "Skill"
                            )
                        },

                        {
                            type: "text",
                            text: String(
                                sector || "Technical"
                            )
                        }

                    ]

                }

            ]

        }

    };

    console.log(
        "[WhatsApp] Sending message to:",
        cleanPhone
    );

    const response =
        await fetch(
            url,
            {
                method: "POST",

                headers: {
                    "Authorization":
                        `Bearer ${ACCESS_TOKEN}`,

                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(payload)
            }
        );

    const data =
        await response
            .json()
            .catch(() => ({}));

    if (!response.ok) {

        console.error(
            "[WhatsApp] Meta API error:",
            JSON.stringify(data, null, 2)
        );

        const metaError =
            data?.error?.message ||
            data?.error?.error_user_msg ||
            `WhatsApp API returned HTTP ${response.status}`;

        const error =
            new Error(metaError);

        error.metaResponse = data;

        error.httpStatus =
            response.status;

        throw error;

    }

    console.log(
        "[WhatsApp] Message sent:",
        data
    );

    return {

        phone: cleanPhone,

        messageId:
            data?.messages?.[0]?.id ||
            null,

        response: data

    };

}

// =====================================================
// SAVE WHATSAPP REPLY
// =====================================================

async function saveWhatsAppReply(
    phone,
    text
) {

    let employmentStatus =
        "Unknown";

    if (
        /self[- ]?employed|business|shop|venture/i
            .test(text)
    ) {

        employmentStatus =
            "Self-Employed";

    }

    else if (
        /looking|unemployed|job search|placement assistance|not working/i
            .test(text)
    ) {

        employmentStatus =
            "Looking for Placement Assistance";

    }

    else if (
        /employed|working|job|placed|salary|joined|company|₹|rs\b/i
            .test(text)
    ) {

        employmentStatus =
            "Employed";

    }

    const verified =
        employmentStatus === "Employed" ||
        employmentStatus === "Self-Employed";

    const traineeResult =
        await pool.query(
            `
            SELECT id
            FROM trainees
            WHERE phone = $1
            LIMIT 1
            `,
            [phone]
        );

    const traineeId =
        traineeResult.rows.length > 0
            ? traineeResult.rows[0].id
            : null;

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
            'WhatsApp',
            $5
        )
        `,
        [
            traineeId,
            phone,
            text,
            employmentStatus,
            verified
        ]
    );

    console.log(
        `[WhatsApp] Response saved for ${phone}`
    );

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

        if (!fs.existsSync(schemaPath)) {

            console.warn(
                "schema.sql not found. Skipping schema initialization."
            );

            return;

        }

        const schema =
            fs.readFileSync(
                schemaPath,
                "utf8"
            );

        await pool.query(schema);

        console.log(
            "PostgreSQL database schema initialized successfully"
        );

    }

    catch (error) {

        console.error(
            "Database initialization failed:",
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
// HEALTH CHECK
// =====================================================

app.get(
    "/api/health",
    (req, res) => {

        res.json({

            success: true,

            server:
                "SkillTrack",

            whatsappConfigured:
                whatsappConfigured,

            databaseConfigured:
                Boolean(
                    process.env.DATABASE_URL
                ),

            whatsappMode:
                "Meta WhatsApp Cloud API",

            template:
                TEMPLATE_NAME

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
                    "PostgreSQL connected successfully",

                time:
                    result.rows[0].current_time

            });

        }

        catch (error) {

            console.error(
                "Database connection error:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Database connection failed",

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
                        row => row.table_name
                    )

            });

        }

        catch (error) {

            console.error(
                "Tables test error:",
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

            await pool.query(`
                ALTER TABLE enrollments
                ADD COLUMN IF NOT EXISTS
                scheme VARCHAR(100);
            `);

            // =================================================
            // TRAINING CENTERS
            // =================================================

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
                const center of centers
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
                    ON CONFLICT (center_id)
                    DO NOTHING
                    `,
                    center
                );

            }

            // =================================================
            // COURSES
            // =================================================

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
                const course of courses
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
                    ON CONFLICT (course_id)
                    DO NOTHING
                    `,
                    course
                );

            }

            // =================================================
            // TRAINEES
            // =================================================

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
                    ON CONFLICT (trainee_id)
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

            // =================================================
            // ENROLLMENTS
            // =================================================

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
                    ON CONFLICT DO NOTHING
                    `,
                    [
                        `BATCH-${String(i).padStart(4, "0")}`,
                        i,
                        status,
                        scheme,
                        traineeId,
                        course[0],
                        center[0]
                    ]
                );

            }

            res.json({

                success: true,

                message:
                    "Demo data seeded successfully"

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
// SEND SURVEY
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
                        "Name is required"

                });

            }

            if (!phone) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Phone number is required"

                });

            }

            const cleanPhone =
                normalizePhone(phone);

            // ---------------------------------------------
            // CHECK TRAINEE
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

            catch (dbLookupError) {

                console.warn(
                    "Trainee lookup failed:",
                    dbLookupError.message
                );

            }

            // ---------------------------------------------
            // SEND WHATSAPP
            // ---------------------------------------------

            const whatsappResult =
                await sendWhatsAppTemplate({

                    phone: cleanPhone,

                    name,

                    course:
                        course || "Skill Training",

                    sector:
                        sector || "General"

                });

            // ---------------------------------------------
            // OPTIONAL MESSAGE LOG
            // ---------------------------------------------

            try {

                await pool.query(
                    `
                    CREATE TABLE IF NOT EXISTS
                    whatsapp_messages
                    (
                        id SERIAL PRIMARY KEY,
                        trainee_id INTEGER,
                        phone VARCHAR(30),
                        message_type VARCHAR(50),
                        template_name VARCHAR(255),
                        status VARCHAR(50),
                        whatsapp_message_id VARCHAR(255),
                        error TEXT,
                        created_at TIMESTAMP DEFAULT NOW(),
                        sent_at TIMESTAMP
                    )
                    `
                );

                await pool.query(
                    `
                    INSERT INTO whatsapp_messages
                    (
                        trainee_id,
                        phone,
                        message_type,
                        template_name,
                        status,
                        whatsapp_message_id,
                        sent_at
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        'template',
                        $3,
                        'sent',
                        $4,
                        NOW()
                    )
                    `,
                    [
                        traineeId,
                        cleanPhone,
                        TEMPLATE_NAME,
                        whatsappResult.messageId
                    ]
                );

            }

            catch (logError) {

                console.warn(
                    "WhatsApp log failed:",
                    logError.message
                );

            }

            // ---------------------------------------------
            // RESPONSE
            // ---------------------------------------------

            return res.json({

                success: true,

                message:
                    "WhatsApp message sent successfully",

                phone:
                    cleanPhone,

                whatsappMessageId:
                    whatsappResult.messageId

            });

        }

        catch (error) {

            console.error(
                "Send survey error:",
                error
            );

            // Try to record failed message
            try {

                const cleanPhone =
                    req.body?.phone
                        ? normalizePhone(
                            req.body.phone
                        )
                        : null;

                await pool.query(
                    `
                    CREATE TABLE IF NOT EXISTS
                    whatsapp_messages
                    (
                        id SERIAL PRIMARY KEY,
                        trainee_id INTEGER,
                        phone VARCHAR(30),
                        message_type VARCHAR(50),
                        template_name VARCHAR(255),
                        status VARCHAR(50),
                        whatsapp_message_id VARCHAR(255),
                        error TEXT,
                        created_at TIMESTAMP DEFAULT NOW(),
                        sent_at TIMESTAMP
                    )
                    `
                );

                await pool.query(
                    `
                    INSERT INTO whatsapp_messages
                    (
                        phone,
                        message_type,
                        template_name,
                        status,
                        error
                    )
                    VALUES
                    (
                        $1,
                        'template',
                        $2,
                        'failed',
                        $3
                    )
                    `,
                    [
                        cleanPhone,
                        TEMPLATE_NAME,
                        error.message
                    ]
                );

            }

            catch (logError) {

                console.warn(
                    "Failed-message logging error:",
                    logError.message
                );

            }

            return res.status(500).json({

                success: false,

                message:
                    "Failed to send WhatsApp message",

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
    (req, res) => {

        res.json({

            success: true,

            configured:
                whatsappConfigured,

            status:
                whatsappConfigured
                    ? "cloud_api_configured"
                    : "not_configured",

            mode:
                "Meta WhatsApp Cloud API",

            phoneNumberId:
                PHONE_NUMBER_ID
                    ? "configured"
                    : "missing",

            accessToken:
                ACCESS_TOKEN
                    ? "configured"
                    : "missing",

            template:
                TEMPLATE_NAME

        });

    }
);

// =====================================================
// META WHATSAPP WEBHOOK VERIFICATION
// =====================================================

app.get(
    "/webhook",
    (req, res) => {

        const mode =
            req.query["hub.mode"];

        const token =
            req.query["hub.verify_token"];

        const challenge =
            req.query["hub.challenge"];

        if (
            mode === "subscribe" &&
            token === VERIFY_TOKEN
        ) {

            console.log(
                "WhatsApp webhook verified"
            );

            return res
                .status(200)
                .send(challenge);

        }

        console.warn(
            "WhatsApp webhook verification failed"
        );

        return res
            .sendStatus(403);

    }
);

// =====================================================
// RECEIVE META WHATSAPP WEBHOOK
// =====================================================

app.post(
    "/webhook",
    async (req, res) => {

        try {

            console.log(
                "[WhatsApp Webhook]",
                JSON.stringify(
                    req.body,
                    null,
                    2
                )
            );

            const entry =
                req.body?.entry || [];

            for (
                const entryItem
                of entry
            ) {

                const changes =
                    entryItem.changes || [];

                for (
                    const change
                    of changes
                ) {

                    const value =
                        change.value;

                    // -----------------------------------------
                    // Incoming messages
                    // -----------------------------------------

                    const messages =
                        value?.messages || [];

                    for (
                        const message
                        of messages
                    ) {

                        if (
                            message.type !==
                            "text"
                        ) {

                            continue;

                        }

                        const phone =
                            message.from;

                        const text =
                            message.text?.body ||
                            "";

                        if (
                            phone &&
                            text
                        ) {

                            await saveWhatsAppReply(
                                phone,
                                text
                            );

                        }

                    }

                    // -----------------------------------------
                    // Message status updates
                    // -----------------------------------------

                    const statuses =
                        value?.statuses || [];

                    for (
                        const status
                        of statuses
                    ) {

                        const messageId =
                            status.id;

                        const messageStatus =
                            status.status;

                        console.log(
                            `[WhatsApp] ${messageId} -> ${messageStatus}`
                        );

                        try {

                            await pool.query(
                                `
                                CREATE TABLE IF NOT EXISTS
                                whatsapp_messages
                                (
                                    id SERIAL PRIMARY KEY,
                                    trainee_id INTEGER,
                                    phone VARCHAR(30),
                                    message_type VARCHAR(50),
                                    template_name VARCHAR(255),
                                    status VARCHAR(50),
                                    whatsapp_message_id VARCHAR(255),
                                    error TEXT,
                                    created_at TIMESTAMP DEFAULT NOW(),
                                    sent_at TIMESTAMP
                                )
                                `
                            );

                            await pool.query(
                                `
                                UPDATE whatsapp_messages
                                SET status = $1
                                WHERE whatsapp_message_id = $2
                                `,
                                [
                                    messageStatus,
                                    messageId
                                ]
                            );

                        }

                        catch (statusDbError) {

                            console.warn(
                                "Unable to update WhatsApp status:",
                                statusDbError.message
                            );

                        }

                    }

                }

            }

            return res.sendStatus(200);

        }

        catch (error) {

            console.error(
                "WhatsApp webhook processing error:",
                error
            );

            // Meta expects a successful response quickly.
            return res.sendStatus(200);

        }

    }
);

// =====================================================
// GOVERNMENT METRICS API
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

            // ---------------------------------------------
            // TRAINEE FILTER
            // ---------------------------------------------

            const traineeParams = [];

            let traineeWhere = "";

            if (
                district !==
                "All Maharashtra"
            ) {

                traineeParams.push(
                    district
                );

                traineeWhere =
                    `WHERE district = $${traineeParams.length}`;

            }

            // ---------------------------------------------
            // ENROLLMENT FILTER
            // ---------------------------------------------

            const enrollmentParams = [];

            let enrollmentWhere = "";

            if (
                district !==
                "All Maharashtra"
            ) {

                enrollmentParams.push(
                    district
                );

                enrollmentWhere = `
                    WHERE trainee_id IN
                    (
                        SELECT id
                        FROM trainees
                        WHERE district = $${enrollmentParams.length}
                    )
                `;

            }

            if (
                scheme !==
                "All Schemes"
            ) {

                enrollmentParams.push(
                    scheme
                );

                enrollmentWhere +=
                    (
                        enrollmentWhere
                            ? " AND "
                            : " WHERE "
                    ) +
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
            // VERIFICATION
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
            // SUPPLY
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
                traineeResult.rows[0].total;

            const employed =
                employmentResult.rows[0].employed;

            const avgSalary =
                Math.round(
                    Number(
                        employmentResult
                            .rows[0]
                            .avg_salary
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

                    skillScore: 74

                },

                verification:
                    verificationResult.rows
                        .map(row => ({

                            source:
                                row.verification_source,

                            count:
                                row.count

                        })),

                demand:
                    demandResult.rows
                        .map(row => ({

                            sector:
                                row.sector,

                            demand:
                                row.demand

                        })),

                supply:
                    supplyResult.rows
                        .map(row => ({

                            sector:
                                row.sector,

                            supply:
                                row.supply

                        }))

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
// TRAINING PROVIDER API
// =====================================================

app.get(
    "/api/training-provider",
    async (req, res) => {

        try {

            const centerId =
                req.query.center_id ||
                null;

            let whereClause = "";

            const params = [];

            if (centerId) {

                params.push(
                    centerId
                );

                whereClause = `
                    WHERE tc.center_id = $1
                `;

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
                                WHERE emp.salary IS NOT NULL
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
                        ON emp.trainee_id =
                           e.trainee_id

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

            // ---------------------------------------------
            // FORMAT BATCHES
            // ---------------------------------------------

            const batches =
                result.rows.map(row => {

                    const enrolled =
                        Number(
                            row.enrolled || 0
                        );

                    const employed =
                        Number(
                            row.employed || 0
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

                });

            // ---------------------------------------------
            // SUMMARY
            // ---------------------------------------------

            const totalEnrolled =
                batches.reduce(
                    (sum, batch) =>
                        sum +
                        batch.enrolled,
                    0
                );

            const totalEmployed =
                batches.reduce(
                    (sum, batch) =>
                        sum +
                        batch.employed,
                    0
                );

            const totalEpfo =
                batches.reduce(
                    (sum, batch) =>
                        sum +
                        batch.epfoVerified,
                    0
                );

            const totalWhatsapp =
                batches.reduce(
                    (sum, batch) =>
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
                    (sum, batch) =>
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
                "Training provider API error:",
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
// START SERVER
// =====================================================

app.listen(
    PORT,
    async () => {

        console.log(
            `SkillTrack server running on port ${PORT}`
        );

        console.log(
            `WhatsApp Cloud API configured: ${whatsappConfigured}`
        );

        await initializeDatabase();

    }
);
