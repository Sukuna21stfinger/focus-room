import { io } from "socket.io-client";
import { API_URL } from "./config";
import { getFocusUserId } from "./focusUser";

const userId = getFocusUserId();
const socket = io(API_URL, {
  autoConnect: false,
  auth: { userId },
  query: { focusUserId: userId },
});

export default socket;
