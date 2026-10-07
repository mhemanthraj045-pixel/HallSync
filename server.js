const express = require("express");
const { MongoClient } = require("mongodb");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = 3000;

const MONGO_URL = "mongodb://127.0.0.1:27017";
const client = new MongoClient(MONGO_URL);

app.use(cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public")));

let users;
let bookings;
const allHalls = [
    "Lawley Hall",
    "Petrine Jubilee Hall",
    "SAIL Hall",
    "Community Centre",
    "Marian Hall",
    "KPJ Hall (K.P. Joseph Hall)",
    "Xavier Hall",
    "Bellarmine Hall",
    "Digby Hall"
];

function toMinutes(time) {
    if (!time || typeof time !== "string") {
        return 0;
    }

    const [hours, minutes] = time.split(":").map(Number);
    return (hours || 0) * 60 + (minutes || 0);
}

function isBookingStillActive(booking) {
    if (!booking || !booking.date || !booking.endTime) {
        return true;
    }

    const today = new Date();
    const todayString = today.toISOString().slice(0, 10);

    if (booking.date !== todayString) {
        return true;
    }

    const currentMinutes = today.getHours() * 60 + today.getMinutes();
    return toMinutes(booking.endTime) > currentMinutes;
}

app.post("/api/signup", async (req, res) => {
    try {
        const { name, register_number, password } = req.body;

        if (!name || !register_number || !password) {
            return res.json({
                success: false,
                message: "Please fill all fields."
            });
        }

        if (typeof password !== "string" || password.length < 6) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 6 characters long."
            });
        }

        if (!users) {
            return res.status(503).json({
                success: false,
                message: "Database is not ready yet. Please try again."
            });
        }

        const existingUser = await users.findOne({
            register_number: register_number
        });

        if (existingUser) {
            return res.json({
                success: false,
                message: "Register number already exists."
            });
        }

        await users.insertOne({
            name: name,
            register_number: register_number,
            password: password,
            created_at: new Date()
        });

        res.json({
            success: true,
            message: "Account created successfully!"
        });

    } catch (error) {
        console.error("Signup error:", error);

        res.status(500).json({
            success: false,
            message: "Server error during signup."
        });
    }
});


app.post("/api/login", async (req, res) => {
    try {
        const { register_number, password } = req.body;

        if (!register_number || !password) {
            return res.json({
                success: false,
                message: "Please enter register number and password."
            });
        }

        if (!users) {
            return res.status(503).json({
                success: false,
                message: "Database is not ready yet. Please try again."
            });
        }

        const user = await users.findOne({
            register_number: register_number
        });

        if (!user) {
            return res.json({
                success: false,
                message: "No account found for this register number. Please create an account first."
            });
        }

        if (user.password !== password) {
            return res.json({
                success: false,
                message: "Incorrect password."
            });
        }

        res.json({
            success: true,
            message: "Login successful!",
            userId: user._id.toString(),
            name: user.name,
            register_number: user.register_number
        });

    } catch (error) {
        console.error("Login error:", error);

        res.status(500).json({
            success: false,
            message: "Server error during login."
        });
    }
});


app.get("/api/availability", async (req, res) => {
    try {
        const { date, startTime, endTime } = req.query;

        if (!date || !startTime || !endTime) {
            return res.status(400).json({
                success: false,
                message: "Please provide date, start time and end time."
            });
        }

        if (!bookings) {
            return res.status(503).json({
                success: false,
                message: "Booking database is not ready yet."
            });
        }

        const overlappingBookings = await bookings.find({
            date: date,
            status: { $ne: "Cancelled" },
            startTime: { $lt: endTime },
            endTime: { $gt: startTime }
        }).toArray();

        const bookedHalls = [...new Set(overlappingBookings.map(booking => booking.hall))];
        const availableHalls = allHalls.filter(hall => !bookedHalls.includes(hall));

        res.json({
            success: true,
            availableHalls,
            bookedHalls
        });

    } catch (error) {
        console.error("Availability check error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to check availability."
        });
    }
});


app.post("/api/bookings", async (req, res) => {
    try {
        const {
            name,
            register_number,
            department,
            hall,
            date,
            startTime,
            endTime,
            purpose
        } = req.body;

        if (
            !name ||
            !register_number ||
            !department ||
            !hall ||
            !date ||
            !startTime ||
            !endTime ||
            !purpose
        ) {
            return res.status(400).json({
                success: false,
                message: "Please fill in all booking details."
            });
        }

        if (startTime >= endTime) {
            return res.status(400).json({
                success: false,
                message: "End time must be after start time."
            });
        }

        if (!bookings) {
            return res.status(503).json({
                success: false,
                message: "Booking database is not ready yet."
            });
        }

        if (!allHalls.includes(hall)) {
            return res.status(400).json({
                success: false,
                message: "Invalid hall selected."
            });
        }

        const conflict = await bookings.findOne({
            hall: hall,
            date: date,

            status: {
                $nin: ["Cancelled", "Rejected"]
            },

            startTime: {
                $lt: endTime
            },

            endTime: {
                $gt: startTime
            }
        });

        if (conflict) {
            return res.status(409).json({
                success: false,
                message:
                    "This hall is already booked for the selected time. Please choose another hall or time."
            });
        }

        const newBooking = {
            name: name,
            register_number: register_number,
            department: department,
            hall: hall,
            date: date,
            startTime: startTime,
            endTime: endTime,
            purpose: purpose,
            status: "Pending",
            created_at: new Date()
        };

        const result = await bookings.insertOne(newBooking);

        res.json({
            success: true,
            message: "Booking request submitted successfully!",
            bookingId: result.insertedId
        });

    } catch (error) {
        console.error("Booking submission error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to submit booking request."
        });
    }
});

app.get("/api/today-availability", async (req, res) => {
    try {
        const { date } = req.query;

        if (!date) {
            return res.status(400).json({
                success: false,
                message: "Date is required."
            });
        }

        if (!bookings) {
            return res.status(503).json({
                success: false,
                message: "Booking database is not ready yet."
            });
        }

        const todayBookings = await bookings.find({
            date: date,
            status: { $ne: "Cancelled" }
        }).toArray();

        const activeTodayBookings = todayBookings.filter(isBookingStillActive);

        const bookedHalls = [...new Set(activeTodayBookings.map(booking => booking.hall))]
            .map(hall => ({
                hall,
                bookings: activeTodayBookings
                    .filter(booking => booking.hall === hall)
                    .map(booking => ({
                        startTime: booking.startTime,
                        endTime: booking.endTime
                    }))
            }));
        const availableHalls = allHalls.filter(
            hall => !bookedHalls.some(booking => booking.hall === hall)
        );

        res.json({
            success: true,
            availableHalls,
            bookedHalls
        });

    } catch (error) {
        console.error("Today's availability error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to load today's availability"
        });
    }
});


async function startServer() {
    try {
        await client.connect();

        console.log("MongoDB connected successfully!");

        const database = client.db("hallsync");
        users = database.collection("users");

        const bookingsExists = await database.listCollections({ name: "bookings" }).hasNext();
        if (!bookingsExists) {
            await database.createCollection("bookings");
            console.log("Created bookings collection");
        }

        bookings = database.collection("bookings");

        console.log("Database: hallsync");
        console.log("Collection: users");
        console.log("Collection: bookings");

        app.listen(PORT, () => {
            console.log(`HallSync running at http://localhost:${PORT}`);
        });

    } catch (error) {
        console.error("MongoDB connection failed:");
        console.error(error);
    }
}

startServer();