require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");

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

app.use(express.static(
    path.join(__dirname)
));


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
                SELECT $1, $2, $3, $4, $5, 'Demo job-market dataset'
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM job_demand
                    WHERE company = $1
                    AND role = $2
                    AND district = $5
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


            if (!phone) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Phone number is required"

                });

            }


            if (
                !ACCESS_TOKEN ||
                !PHONE_NUMBER_ID
            ) {

                return res.status(500).json({

                    success: false,

                    error:
                        "WhatsApp API is not configured on the server"

                });

            }


            const cleanPhone =
                String(phone)
                    .replace(/\D/g, "");


            const url =
                `https://graph.facebook.com/` +
                `${GRAPH_VERSION}/` +
                `${PHONE_NUMBER_ID}/messages`;


            const payload = {

                messaging_product:
                    "whatsapp",

                to:
                    cleanPhone,

                type:
                    "template",

                template: {

                    name:
                        TEMPLATE_NAME,

                    language: {

                        code:
                            TEMPLATE_LANGUAGE

                    },

                    components: [

                        {

                            type:
                                "body",

                            parameters: [

                                {

                                    type:
                                        "text",

                                    text:
                                        String(
                                            name ||
                                            "Trainee"
                                        )

                                },

                                {

                                    type:
                                        "text",

                                    text:
                                        String(
                                            course ||
                                            "your training"
                                        )

                                },

                                {

                                    type:
                                        "text",

                                    text:
                                        String(
                                            sector ||
                                            "your sector"
                                        )

                                }

                            ]

                        }

                    ]

                }

            };


            const response =
                await fetch(
                    url,
                    {

                        method:
                            "POST",

                        headers: {

                            "Authorization":
                                `Bearer ${ACCESS_TOKEN}`,

                            "Content-Type":
                                "application/json"

                        },

                        body:
                            JSON.stringify(
                                payload
                            )

                    }
                );


            const result =
                await response.json();


            if (!response.ok) {

                console.error(
                    "Meta API Error:",
                    result
                );


                return res.status(
                    response.status
                ).json({

                    success:
                        false,

                    error:
                        result?.error?.message ||
                        "WhatsApp API error",

                    details:
                        result

                });

            }


            const messageId =
                result?.messages?.[0]?.id;


            return res.json({

                success:
                    true,

                messageId:
                    messageId || null,

                message:
                    "WhatsApp message accepted by Meta"

            });


        } catch (error) {

            console.error(
                error
            );


            return res.status(500).json({

                success:
                    false,

                error:
                    error.message ||
                    "Internal server error"

            });

        }

    }
);


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
