import { useState } from "react";
import type { ClientMessage_t } from "@cosmos/shared";

type UseRoomActionsArgs_t = {
  sendMessage: (payload: ClientMessage_t) => boolean;
  setErrorText: (value: string) => void;
};

export const useRoomActions = ({ sendMessage, setErrorText }: UseRoomActionsArgs_t) => {
  const [roomName, setRoomName] = useState<string>("");

  const createRoom = () => {
    if (!roomName.trim()) {
      setErrorText("Enter room name");
      return;
    }

    setErrorText("");
    const sent = sendMessage({
      type: "create_room",
      roomName,
    });

    if (sent) {
      setRoomName("");
    }
  };

  const joinRoom = (roomId: string) => {
    setErrorText("");
    sendMessage({
      type: "join_room",
      roomId,
    });
  };

  return {
    roomName,
    setRoomName,
    createRoom,
    joinRoom,
  };
};
