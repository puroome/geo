import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDC4YYrKTV8p0ZKyUYYf5hsWA86RF98iX4",
  authDomain: "geo-game-a30c1.firebaseapp.com",
  projectId: "geo-game-a30c1",
  storageBucket: "geo-game-a30c1.firebasestorage.app",
  messagingSenderId: "233890416056",
  appId: "1:233890416056:web:3ae5dc510d698ff8487b4d"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
