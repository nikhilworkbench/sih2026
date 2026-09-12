require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");

const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

const app = express();

const PORT = process.env.PORT || 5000;

// ================================
// POSTGRESQL DATABASE
// ================================

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false
});


// ================================
// WHATSAPP CONFIGURATION
// ================================

const ACCESS_TOKEN =
    process.env.WHATSAPP_ACCESS_TOKEN;

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


app.use(express.json());

// =====================================================
// WHATSAPP WEB.JS AUTOMATION
// =====================================================

const whatsappClient = new Client({
    authStrategy: new LocalAuth({
        clientId: "skilltrack"
    }),
    puppeteer: {
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu"
        ]
    }
});

let whatsappReady = false;

whatsappClient.on("qr", (qr) => {
    console.log("");
    console.log("==============================================");
    console.log("SCAN WHATSAPP QR CODE FROM RENDER LOGS");
    console.log("WhatsApp > Linked Devices > Link a Device");
    console.log("==============================================");

    qrcode.generate(qr, { small: true });
});

whatsappClient.on("ready", () => {
    whatsappReady = true;
    console.log("WhatsApp Web.js is READY and CONNECTED.");
});

whatsappClient.on("authenticated", () => {
    console.log("WhatsApp authentication successful.");
});

whatsappClient.on("auth_failure", (message) => {
    whatsappReady = false;
    console.error("WhatsApp authentication failed:", message);
});

whatsappClient.on("disconnected", (reason) => {
    whatsappReady = false;
    console.log("WhatsApp disconnected:", reason);
});

app.use(express.static(
    path.join(__dirname)
));

// =====================================================
// RECEIVE TRAINEE WHATSAPP REPLIES
// =====================================================

whatsappClient.on("message", async (msg) => {

    try {

        if (msg.from.endsWith("@g.us")) {
            return;
        }

        const phone = msg.from.replace("@c.us", "");
        const text = (msg.body || "").trim();

        if (!text) {
            return;
        }

        let employmentStatus = "Unknown";

        if (/self[- ]?employed|business|shop|venture/i.test(text)) {

            employmentStatus = "Self-Employed";

        } else if (/looking|unemployed|job search|placement assistance|not working/i.test(text)) {

            employmentStatus = "Looking for Placement Assistance";

        } else if (/employed|working|job|placed|salary|joined|company|₹|rs\b/i.test(text)) {

            employmentStatus = "Employed";
        }

        const verified =
            employmentStatus === "Employed" ||
            employmentStatus === "Self-Employed";

        console.log(
            `[WhatsApp Reply] ${phone} -> ${text}`
        );

        const traineeResult = await pool.query(
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
            VALUES ($1, $2, $3, $4, 'WhatsApp', $5)
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

    } catch (error) {

        console.error(
            "WhatsApp inbound processing error:",
            error
        );
    }

});


// ================================
// DATABASE INITIALIZATION
// ================================

async function initializeDatabase() {

    try {

        const schemaPath =
            path.join(__dirname, "schema.sql");

        const schema =
            fs.readFileSync(
                schemaPath,
                "utf8"
            );

        await pool.query(schema);

        console.log(
            "PostgreSQL database schema initialized successfully"
        );

    } catch (error) {

        console.error(
            "Database initialization failed:",
            error.message
        );

    }

}


// ================================
// HOME
// ================================

app.get("/", (req, res) => {

    res.sendFile(
        path.join(__dirname, "index.html")
    );

});


// ================================
// HEALTH CHECK
// ================================

app.get("/api/health", (req, res) => {

    res.json({

        success: true,

        whatsappConfigured:
            Boolean(
                ACCESS_TOKEN &&
                PHONE_NUMBER_ID
            ),

        databaseConfigured:
            Boolean(
                process.env.DATABASE_URL
            ),

        template:
            TEMPLATE_NAME

    });

});


// ================================
// DATABASE TEST
// ================================

app.get("/api/db-test", async (req, res) => {

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

    } catch (error) {

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

});

app.get("/api/tables-test", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_name;
        `);

        res.json({
            success: true,
            tables: result.rows.map(row => row.table_name)
        });

    } catch (error) {
        console.error("Tables test error:", error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ================================
// SEED PMKVY / MAHARASHTRA DEMO DATA
// ================================

app.get("/api/seed-demo", async (req, res) => {

    try {

        // Safety check
        if (req.query.key !== "SKILLTRACK2026") {
            return res.status(403).json({
                success: false,
                error: "Unauthorized"
            });
        }

        // Add scheme column if it does not already exist
        await pool.query(`
            ALTER TABLE enrollments
            ADD COLUMN IF NOT EXISTS scheme VARCHAR(100);
        `);

        // --------------------------------
        // 1. TRAINING CENTERS
        // --------------------------------

        const centers = [
            ["MSSDS-PUN-001", "Government ITI Aundh", "Pune", "Maharashtra", "A"],
            ["MSSDS-PUN-002", "Skill Development Centre Pune", "Pune", "Maharashtra", "A"],
            ["MSSDS-NAG-001", "Government Skill Centre Nagpur", "Nagpur", "Maharashtra", "A"],
            ["MSSDS-THA-001", "Skill Development Centre Thane", "Thane", "Maharashtra", "B"],
            ["MSSDS-AUR-001", "Government ITI Chhatrapati Sambhajinagar", "Aurangabad", "Maharashtra", "A"],
            ["MSSDS-NAS-001", "Skill Development Centre Nashik", "Nashik", "Maharashtra", "B"],
            ["MSSDS-KOL-001", "Government Skill Centre Kolhapur", "Kolhapur", "Maharashtra", "B"],
            ["MSSDS-SOL-001", "Skill Development Centre Solapur", "Solapur", "Maharashtra", "B"]
        ];

        for (const center of centers) {

            await pool.query(`
                INSERT INTO training_centers
                (center_id, name, district, state, grade)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (center_id) DO NOTHING
            `, center);

        }


        // --------------------------------
        // 2. COURSES
        // --------------------------------

        const courses = [
            ["CRS-001", "Data Entry Operator", "IT-ITeS", 3],
            ["CRS-002", "Web Developer", "IT-ITeS", 6],
            ["CRS-003", "Electrician", "Electrical", 6],
            ["CRS-004", "Solar PV Installer", "Green Jobs", 3],
            ["CRS-005", "Automotive Service Technician", "Automotive", 6],
            ["CRS-006", "General Duty Assistant", "Healthcare", 3],
            ["CRS-007", "Retail Sales Associate", "Retail", 3],
            ["CRS-008", "CNC Machine Operator", "Capital Goods", 6],
            ["CRS-009", "Beauty Therapist", "Beauty & Wellness", 3],
            ["CRS-010", "Warehouse Associate", "Logistics", 3]
        ];

        for (const course of courses) {

            await pool.query(`
                INSERT INTO courses
                (course_id, name, sector, duration_months)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (course_id) DO NOTHING
            `, course);

        }


        // --------------------------------
        // 3. TRAINEES
        // --------------------------------

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

        for (let i = 1; i <= 500; i++) {

            const traineeId =
                `MH-SKILL-${String(i).padStart(5, "0")}`;

            const name =
                firstNames[(i - 1) % firstNames.length];

            const district =
                districts[(i - 1) % districts.length];

            const phone =
                `91${7000000000 + i}`;

            await pool.query(`
                INSERT INTO trainees
                (trainee_id, name, phone, district, registration_date)
                VALUES
                ($1, $2, $3, $4, CURRENT_DATE - (($5 % 365)::int))
                ON CONFLICT (trainee_id) DO NOTHING
            `, [
                traineeId,
                `${name} ${1000 + i}`,
                phone,
                district,
                i
            ]);

        }


        // --------------------------------
        // 4. ENROLLMENTS
        // --------------------------------

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

        for (let i = 1; i <= 500; i++) {

            const traineeId =
                `MH-SKILL-${String(i).padStart(5, "0")}`;

            const course =
                courses[(i - 1) % courses.length];

            const center =
                centers[(i - 1) % centers.length];

            const scheme =
                schemes[(i - 1) % schemes.length];

            const status =
                i % 10 === 0
                    ? "Enrolled"
                    : i % 7 === 0
                        ? "In Progress"
                        : "Completed";

            await pool.query(`
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
                    CURRENT_DATE - (($2 % 300)::int),
                    CASE
                        WHEN $3 = 'Completed'
                        THEN CURRENT_DATE - (($2 % 150)::int)
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
                    WHERE e.trainee_id = t.id
                )
            `, [
                `BATCH-${Math.floor((i - 1) / 25) + 1}`,
                i,
                status,
                scheme,
                traineeId,
                course[0],
                center[0]
            ]);

        }


        // --------------------------------
        // 5. EMPLOYMENT OUTCOMES
        // --------------------------------

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

        for (let i = 1; i <= 500; i++) {

            // Approximately 68% employed
            if (i % 100 > 67) {
                continue;
            }

            const traineeId =
                `MH-SKILL-${String(i).padStart(5, "0")}`;

            const salary =
                10000 + ((i * 137) % 18000);

            const company =
                companies[(i - 1) % companies.length];

            const role =
                roles[(i - 1) % roles.length];

            const source =
                verificationSources[(i - 1) % verificationSources.length];

            await pool.query(`
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
                    CURRENT_DATE - (($4 % 120)::int),
                    $5,
                    TRUE
                FROM trainees
                WHERE trainee_id = $6
                AND NOT EXISTS (
                    SELECT 1
                    FROM employment e
                    WHERE e.trainee_id = trainees.id
                )
            `, [
                company,
                role,
                salary,
                i,
                source,
                traineeId
            ]);

        }


        // --------------------------------
        // 6. JOB DEMAND
        // --------------------------------

        const demands = [
            ["Tata Auto Systems", "Automotive Technician", "Automotive", 180, "Pune"],
            ["Tech Mahindra", "Junior Web Developer", "IT-ITeS", 250, "Pune"],
            ["Infosys", "Data Entry Operator", "IT-ITeS", 140, "Pune"],
            ["Adani Green", "Solar Technician", "Green Jobs", 220, "Nagpur"],
            ["Apollo Partner Network", "Healthcare Assistant", "Healthcare", 160, "Thane"],
            ["RetailMart India", "Retail Associate", "Retail", 190, "Pune"],
            ["Industrial Solutions", "CNC Operator", "Capital Goods", 120, "Aurangabad"],
            ["LogiMove India", "Warehouse Associate", "Logistics", 210, "Nashik"]
        ];

        for (const demand of demands) {

            await pool.query(`
                INSERT INTO job_demand
                (company, role, sector, openings, district, source)
                SELECT
                    $1::VARCHAR,
                    $2::VARCHAR,
                    $3::VARCHAR,
                    $4::INTEGER,
                    $5::VARCHAR,
                    'Demo job-market dataset'
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM job_demand
                    WHERE company = $1::VARCHAR
                    AND role = $2::VARCHAR
                    AND district = $5::VARCHAR
                )
            `, demand);

        }


        // --------------------------------
        // RESULT
        // --------------------------------

        const counts = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM trainees) AS trainees,
                (SELECT COUNT(*) FROM training_centers) AS training_centers,
                (SELECT COUNT(*) FROM courses) AS courses,
                (SELECT COUNT(*) FROM enrollments) AS enrollments,
                (SELECT COUNT(*) FROM employment) AS employment,
                (SELECT COUNT(*) FROM job_demand) AS job_demand
        `);

        res.json({

            success: true,

            message:
                "PMKVY/Maharashtra-based synthetic demo data inserted successfully",

            warning:
                "Individual trainee records are synthetic and must not be presented as actual government beneficiary records.",

            counts:
                counts.rows[0]

        });

    } catch (error) {

        console.error(
            "Demo data seed error:",
            error
        );

        res.status(500).json({

            success: false,

            error:
                error.message

        });

    }

});

// ================================
// SEND WHATSAPP MESSAGE
// ================================

app.post("/api/send-survey", async (req, res) => {
    try {

        const {
            name,
            phone,
            course,
            sector
        } = req.body;

        if (!phone) {
            return res.status(400).json({
                success: false,
                error: "Phone number is required"
            });
        }

        if (!whatsappReady) {
            return res.status(503).json({
                success: false,
                error: "WhatsApp is not connected. Scan the QR code from Render logs."
            });
        }

        let cleanPhone = String(phone).replace(/\D/g, "");

        if (cleanPhone.length === 10) {
            cleanPhone = "91" + cleanPhone;
        }

        const chatId = `${cleanPhone}@c.us`;

        const message =
`Namaskar ${name || "Trainee"},

Greetings from KaushalSetu Maharashtra Skill Mission!

We noticed you completed the *${course || "Skill"}* course in the *${sector || "Technical"}* sector.

Please reply with your current employment status:

1. Employed - Company name & Monthly salary
2. Self-Employed - Shop / Venture details
3. Looking for Placement Assistance

Your response helps update your skill training outcome record.

Thank you,
KaushalSetu`;

        await whatsappClient.sendMessage(
            chatId,
            message
        );

        console.log(
            `[WhatsApp] Survey sent to ${cleanPhone}`
        );

        res.json({
            success: true,
            message: `Survey dispatched to ${cleanPhone}`
        });

    } catch (error) {

        console.error(
            "WhatsApp dispatch failed:",
            error
        );

        res.status(500).json({
            success: false,
            error: "Failed to send WhatsApp message",
            detail: error.message
        });
    }
});

// ================================
// WHATSAPP WEBHOOK VERIFICATION
// ================================

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


        return res.sendStatus(403);

    }
);


// ================================
// WHATSAPP WEBHOOK
// ================================

app.post(
    "/webhook",
    (req, res) => {

        try {

            const body =
                req.body;


            console.log(
                "WhatsApp webhook received:"
            );


            console.log(
                JSON.stringify(
                    body,
                    null,
                    2
                )
            );


            return res.sendStatus(200);


        } catch (error) {

            console.error(
                error
            );

            return res.sendStatus(500);

        }

    }
);

app.get("/api/government-metrics", async (req, res) => {
  try {
    const district = req.query.district || "All Maharashtra";
    const scheme = req.query.scheme || "All Schemes";

    let traineeWhere = "";
    let enrollmentWhere = "";
    const traineeParams = [];
    const enrollmentParams = [];

    if (district !== "All Maharashtra") {
      traineeParams.push(district);
      traineeWhere = `WHERE district = $${traineeParams.length}`;

      enrollmentParams.push(district);
      enrollmentWhere = `
        WHERE trainee_id IN (
          SELECT id FROM trainees WHERE district = $${enrollmentParams.length}
        )
      `;
    }

    if (scheme !== "All Schemes") {
      enrollmentParams.push(scheme);
      enrollmentWhere +=
        (enrollmentWhere ? " AND " : " WHERE ") +
        `scheme = $${enrollmentParams.length}`;
    }

    // Total trainees
    const traineeResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM trainees ${traineeWhere}`,
      traineeParams
    );

    // Employment / placement
    const employmentResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE e.status = 'Employed')::int AS employed,
        COALESCE(AVG(e.salary) FILTER (WHERE e.salary IS NOT NULL), 0)::numeric AS avg_salary
      FROM employment e
      JOIN trainees t ON t.id = e.trainee_id
      ${district !== "All Maharashtra" ? "WHERE t.district = $1" : ""}
    `, district !== "All Maharashtra" ? [district] : []);

    // Verification sources
    const verificationResult = await pool.query(`
      SELECT verification_source, COUNT(*)::int AS count
      FROM employment e
      JOIN trainees t ON t.id = e.trainee_id
      ${district !== "All Maharashtra" ? "WHERE t.district = $1" : ""}
      GROUP BY verification_source
    `, district !== "All Maharashtra" ? [district] : []);

    // Sector demand
    const demandResult = await pool.query(`
      SELECT sector, SUM(openings)::int AS demand
      FROM job_demand
      ${district !== "All Maharashtra" ? "WHERE district = $1" : ""}
      GROUP BY sector
      ORDER BY demand DESC
    `, district !== "All Maharashtra" ? [district] : []);

    // Supply by course sector
    const supplyResult = await pool.query(`
      SELECT c.sector, COUNT(*)::int AS supply
      FROM enrollments e
      JOIN courses c ON c.id = e.course_id
      JOIN trainees t ON t.id = e.trainee_id
      ${enrollmentWhere}
      GROUP BY c.sector
      ORDER BY supply DESC
    `, enrollmentParams);

    const total = traineeResult.rows[0].total;
    const employed = employmentResult.rows[0].employed;
    const avgSalary = Math.round(
      Number(employmentResult.rows[0].avg_salary)
    );

    const placementRate = total > 0
      ? Number(((employed / total) * 100).toFixed(1))
      : 0;

    res.json({
      success: true,

      metrics: {
        total,
        placementRate,
        avgSalary,
        skillScore: 74
      },

      verification: verificationResult.rows.map(row => ({
        source: row.verification_source,
        count: row.count
      })),

      demand: demandResult.rows.map(row => ({
        sector: row.sector,
        demand: row.demand
      })),

      supply: supplyResult.rows.map(row => ({
        sector: row.sector,
        supply: row.supply
      }))
    });

  } catch (error) {
    console.error("Government metrics error:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// TRAINING PROVIDER DASHBOARD API
// =====================================================

app.get("/api/training-provider", async (req, res) => {

    try {

        const centerId =
            req.query.center_id || null;

        let whereClause = "";
        const params = [];


        if (centerId) {

            params.push(centerId);

            whereClause = `
                WHERE tc.center_id = $1
            `;

        }


        const result = await pool.query(`

            SELECT

                tc.center_id,
                tc.name AS center_name,
                tc.district,

                c.course_id,
                c.name AS course_name,
                c.sector,

                e.batch_id,

                COUNT(DISTINCT e.trainee_id)::int
                    AS enrolled,

                COUNT(DISTINCT e.trainee_id)
                    FILTER (
                        WHERE emp.status = 'Employed'
                    )::int
                    AS employed,

                COUNT(DISTINCT e.trainee_id)
                    FILTER (
                        WHERE emp.verification_source = 'EPFO'
                    )::int
                    AS epfo_verified,

                COUNT(DISTINCT e.trainee_id)
                    FILTER (
                        WHERE emp.verification_source = 'WhatsApp'
                    )::int
                    AS whatsapp_verified,

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

        `, params);


        const batches = result.rows.map(row => {

            const enrolled =
                Number(row.enrolled || 0);

            const employed =
                Number(row.employed || 0);

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
                        row.epfo_verified || 0
                    ),

                whatsappVerified:
                    Number(
                        row.whatsapp_verified || 0
                    ),

                avgSalary:
                    Math.round(
                        Number(
                            row.avg_salary || 0
                        )
                    )

            };

        });


        // =================================================
        // OVERALL SUMMARY
        // =================================================

        const totalEnrolled =
            batches.reduce(

                (sum, batch) =>
                    sum + batch.enrolled,

                0

            );


        const totalEmployed =
            batches.reduce(

                (sum, batch) =>
                    sum + batch.employed,

                0

            );


        const totalEpfo =
            batches.reduce(

                (sum, batch) =>
                    sum + batch.epfoVerified,

                0

            );


        const totalWhatsapp =
            batches.reduce(

                (sum, batch) =>
                    sum + batch.whatsappVerified,

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

            error: error.message

        });

    }

});

app.get("/api/whatsapp-status", (req, res) => {

    res.json({
        success: true,
        connected: whatsappReady,
        status: whatsappReady
            ? "connected"
            : "disconnected"
    });

});

// ================================
// START WHATSAPP
// ================================

whatsappClient.initialize().catch((error) => {

    console.error(
        "WhatsApp initialization failed:",
        error
    );

});

// ================================
// START SERVER
// ================================

app.listen(
    PORT,
    async () => {

        console.log(
            `SkillTrack server running on port ${PORT}`
        );

        await initializeDatabase();

    }
);
