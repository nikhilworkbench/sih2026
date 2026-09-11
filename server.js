const express = require("express");
const path = require("path");
require("dotenv").config();

const app = express();

const PORT = process.env.PORT || 5000;

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
        template: TEMPLATE_NAME
    });

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


            // Remove spaces, +, -, etc.
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

                to: cleanPhone,

                type: "template",

                template: {

                    name:
                        TEMPLATE_NAME,

                    language: {
                        code:
                            TEMPLATE_LANGUAGE
                    },

                    components: [

                        {
                            type: "body",

                            parameters: [

                                {
                                    type: "text",
                                    text:
                                        String(
                                            name || "Trainee"
                                        )
                                },

                                {
                                    type: "text",
                                    text:
                                        String(
                                            course || "your training"
                                        )
                                },

                                {
                                    type: "text",
                                    text:
                                        String(
                                            sector || "your sector"
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

                        method: "POST",

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

                    success: false,

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

                success: true,

                messageId:

                    messageId || null,

                message:
                    "WhatsApp message accepted by Meta"

            });


        } catch (error) {

            console.error(error);


            return res.status(500).json({

                success: false,

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

            return res.status(200)
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

            const body = req.body;


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


            /*
             * Here you can process:
             *
             * incoming trainee replies
             * message status
             * delivery status
             * read status
             */


            return res.sendStatus(200);


        } catch (error) {

            console.error(error);

            return res.sendStatus(500);

        }

    }
);


// ================================
// START SERVER
// ================================

app.listen(
    PORT,
    () => {

        console.log(
            `SkillTrack server running on port ${PORT}`
        );

    }
);
