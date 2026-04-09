import React, { useState, useEffect, useRef } from "react";

// Polyfill for simple-peer in browser
if (typeof window !== 'undefined') {
  (window as any).process = (window as any).process || {};
  (window as any).process.nextTick = (window as any).process.nextTick || ((fn: any) => setTimeout(fn, 0));
}

import { io, Socket } from "socket.io-client";
import Peer from "simple-peer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { 
  Users, Send, LogOut, ShieldCheck, User, MessageSquare, 
  GraduationCap, Mic, MicOff, Video, VideoOff, Hand, 
  MonitorUp, MoreVertical, PhoneOff, Info, Settings,
  ChevronLeft, ChevronRight, UserX, BarChart2, PlusCircle, Trash2,
  PauseCircle, PlayCircle
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// --- Types ---
interface UserData {
  id: string;
  name: string;
  role: "teacher" | "student";
  handRaised?: boolean;
  isMicOn?: boolean;
  isCamOn?: boolean;
  isSpeaking?: boolean;
  isScreenSharing?: boolean;
  isScreenPaused?: boolean;
}

interface Message {
  id: string;
  sender: string;
  role?: string;
  text: string;
  timestamp: string;
  type: "user" | "system";
}

interface PollOption {
  text: string;
  votes: string[]; // array of socket IDs
}

interface Poll {
  id: string;
  question: string;
  options: PollOption[];
  creatorName: string;
  isActive: boolean;
  timestamp: string;
}

interface PeerState {
  peerID: string;
  peer: Peer.Instance;
  name: string;
  role: string;
  stream?: MediaStream;
}

// --- Video Component ---
const VideoComponent = ({ 
  stream, 
  name, 
  role, 
  handRaised, 
  isMicOn = true, 
  isCamOn = true, 
  isSpeaking = false,
  isLocal = false 
}: { 
  stream?: MediaStream; 
  name: string; 
  role: string; 
  handRaised?: boolean; 
  isMicOn?: boolean;
  isCamOn?: boolean;
  isSpeaking?: boolean;
  isLocal?: boolean 
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className={`relative group bg-slate-900 rounded-xl overflow-hidden aspect-video flex items-center justify-center border-2 transition-all duration-300 ${
      isSpeaking ? "border-green-500 shadow-[0_0_15px_rgba(34,197,94,0.4)]" : "border-slate-800 shadow-lg"
    }`}>
      {/* Video element must stay mounted to play audio even when camera is off */}
      {stream && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className={`w-full h-full object-cover ${!isCamOn ? "hidden" : "block"}`}
        />
      )}
      
      {!isCamOn && (
        <div className="w-full h-full bg-slate-800 flex items-center justify-center relative">
          <div className={`w-20 h-20 rounded-full flex items-center justify-center text-white text-3xl font-bold shadow-2xl transition-all duration-300 ${
            isSpeaking ? "bg-green-500 scale-110" : "bg-indigo-600"
          }`}>
            {name.charAt(0).toUpperCase()}
          </div>
          <div className="absolute top-4 right-4 bg-red-500/20 p-2 rounded-full backdrop-blur-sm">
            <VideoOff className="w-4 h-4 text-red-500" />
          </div>
        </div>
      )}
      
      <div className="absolute bottom-3 left-3 flex items-center gap-2">
        <div className="flex items-center gap-1.5 bg-black/50 backdrop-blur-md rounded-full py-0.5 px-2.5">
          {!isMicOn ? (
            <MicOff className="w-3 h-3 text-red-500" />
          ) : isSpeaking ? (
            <motion.div
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ repeat: Infinity, duration: 1 }}
            >
              <Mic className="w-3 h-3 text-green-400" />
            </motion.div>
          ) : (
            <Mic className="w-3 h-3 text-slate-400" />
          )}
          <span className="text-white text-[10px] font-medium">
            {name} {isLocal && "(You)"}
          </span>
        </div>
        {role === "teacher" && (
          <Badge className="bg-amber-500 border-none text-white text-[9px] py-0 px-1.5 h-4">Host</Badge>
        )}
      </div>

      {handRaised && (
        <motion.div 
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="absolute top-3 right-3 bg-amber-400 p-1.5 rounded-full shadow-lg"
        >
          <Hand className="w-4 h-4 text-white fill-white" />
        </motion.div>
      )}
    </div>
  );
};

// --- App Component ---
export default function App() {
  const [isJoined, setIsJoined] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [user, setUser] = useState<{ name: string; role: "teacher" | "student" } | null>(null);
  const [users, setUsers] = useState<UserData[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [socket, setSocket] = useState<Socket | null>(null);
  
  // Media States
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [displayStream, setDisplayStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<PeerState[]>([]);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCamOn, setIsCamOn] = useState(true);
  const [isHandRaised, setIsHandRaised] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isScreenPaused, setIsScreenPaused] = useState(false);
  const [presenterId, setPresenterId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  // UI States
  const [sidePanel, setSidePanel] = useState<"chat" | "people" | "polls" | null>(null);
  
  const socketRef = useRef<Socket | null>(null);
  const peersRef = useRef<PeerState[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);

  useEffect(() => {
    if (isMicOn && localStream) {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(localStream);
      source.connect(analyser);
      analyser.fftSize = 512;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      let speakingTimeout: any = null;

      const checkSpeaking = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        const speaking = average > 20; // Threshold

        if (speaking) {
          if (!isSpeaking) {
            setIsSpeaking(true);
            socket?.emit("speaking-status", true);
          }
          if (speakingTimeout) clearTimeout(speakingTimeout);
          speakingTimeout = setTimeout(() => {
            setIsSpeaking(false);
            socket?.emit("speaking-status", false);
          }, 1000);
        }

        requestAnimationFrame(checkSpeaking);
      };

      checkSpeaking();

      return () => {
        audioContext.close();
      };
    }
  }, [isMicOn, localStream, socket]);

  useEffect(() => {
    if (isVerified && user) {
      const initMedia = async () => {
        setMediaError(null);
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          
          // Apply initial states
          stream.getAudioTracks()[0].enabled = isMicOn;
          stream.getVideoTracks()[0].enabled = isCamOn;

          setLocalStream(stream);
          setDisplayStream(stream);
          localStreamRef.current = stream;
          activeStreamRef.current = stream;
          
          if (isJoined) {
            const newSocket = io();
            setSocket(newSocket);
            socketRef.current = newSocket;

            newSocket.emit("join-room", { 
              name: user.name, 
              role: user.role,
              isMicOn,
              isCamOn
            });

            newSocket.on("all-users", (existingUsers: UserData[]) => {
              const newPeers: PeerState[] = [];
              existingUsers.forEach(u => {
                const peer = createPeer(u.id, newSocket.id!, activeStreamRef.current!, user.name, user.role);
                peersRef.current.push({
                  peerID: u.id,
                  peer,
                  name: u.name,
                  role: u.role
                });
                newPeers.push({ peerID: u.id, peer, name: u.name, role: u.role });
              });
              setPeers(newPeers);
            });

            newSocket.on("user-joined", payload => {
              const peer = addPeer(payload.signal, payload.callerID, activeStreamRef.current!);
              const peerObj = {
                peerID: payload.callerID,
                peer,
                name: payload.name,
                role: payload.role
              };
              peersRef.current.push(peerObj);
              setPeers(prev => [...prev, peerObj]);
            });

            newSocket.on("receiving-returned-signal", payload => {
              const item = peersRef.current.find(p => p.peerID === payload.id);
              if (item) {
                item.peer.signal(payload.signal);
              }
            });

            newSocket.on("users", (updatedUsers: UserData[]) => {
              setUsers(updatedUsers);
            });

            newSocket.on("message", (msg: Message) => {
              setMessages((prev) => [...prev, msg]);
            });

            newSocket.on("all-polls", (existingPolls: Poll[]) => {
              setPolls(existingPolls);
            });

            newSocket.on("poll-created", (poll: Poll) => {
              setPolls((prev) => [...prev, poll]);
              toast.info(`New poll: ${poll.question}`);
            });

            newSocket.on("poll-updated", (updatedPoll: Poll) => {
              setPolls((prev) => prev.map(p => p.id === updatedPoll.id ? updatedPoll : p));
            });

            newSocket.on("user-disconnected", id => {
              const peerObj = peersRef.current.find(p => p.peerID === id);
              if (peerObj) peerObj.peer.destroy();
              const filteredPeers = peersRef.current.filter(p => p.peerID !== id);
              peersRef.current = filteredPeers;
              setPeers(filteredPeers);
              if (presenterId === id) setPresenterId(null);
              if (pinnedId === id) setPinnedId(null);
            });

            newSocket.on("presenter-changed", (id: string | null) => {
              setPresenterId(id);
            });

            newSocket.on("kicked", () => {
              toast.error("You have been removed from the class by the teacher.");
              handleLeave();
            });
          }

        } catch (err: any) {
          console.error("Media error:", err);
          setMediaError(err.message || "Permission denied");
          toast.error("Could not access camera/microphone. Please ensure permissions are granted.");
        }
      };

      initMedia();

      return () => {
        if (socketRef.current) socketRef.current.disconnect();
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(track => track.stop());
        }
      };
    }
  }, [isVerified, isJoined, user]);

  function createPeer(userToSignal: string, callerID: string, stream: MediaStream, name: string, role: string) {
    const peer = new Peer({
      initiator: true,
      trickle: false,
      stream,
    });

    peer.on("signal", signal => {
      socketRef.current?.emit("sending-signal", { userToSignal, callerID, signal, name, role });
    });

    return peer;
  }

  function addPeer(incomingSignal: Peer.SignalData, callerID: string, stream: MediaStream) {
    const peer = new Peer({
      initiator: false,
      trickle: false,
      stream,
    });

    peer.on("signal", signal => {
      socketRef.current?.emit("returning-signal", { signal, callerID });
    });

    peer.signal(incomingSignal);

    return peer;
  }

  const handleJoin = async (name: string, admissionNo: string, role: "teacher" | "student", idCode?: string) => {
    try {
      const response = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, admissionNo, role, idCode }),
      });

      const data = await response.json();

      if (data.success) {
        setUser({ name: data.displayName, role });
        setIsVerified(true);
        toast.success(`Verification successful, ${data.displayName}!`);
      } else {
        toast.error(data.message || "Verification failed");
      }
    } catch (error) {
      toast.error("Connection error. Please try again.");
    }
  };

  const toggleMic = async () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (isMicOn) {
        // Turning OFF: Stop the track to release the hardware
        audioTrack.enabled = false;
        audioTrack.stop();
        setIsMicOn(false);
        socket?.emit("toggle-mic", false);
      } else {
        // Turning ON: Re-acquire the track
        try {
          const newStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const newTrack = newStream.getAudioTracks()[0];
          
          // Replace in local stream
          localStream.removeTrack(audioTrack);
          localStream.addTrack(newTrack);
          
          // Replace for all peers
          peersRef.current.forEach(p => {
            try {
              p.peer.replaceTrack(audioTrack, newTrack, localStream);
            } catch (e) {
              console.error("Error replacing audio track:", e);
            }
          });
          
          setIsMicOn(true);
          socket?.emit("toggle-mic", true);
        } catch (err) {
          toast.error("Could not access microphone. Please check permissions.");
        }
      }
    }
  };

  const toggleCam = async () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (isCamOn) {
        // Turning OFF: Stop the track to release the hardware (turns off the light)
        videoTrack.enabled = false;
        videoTrack.stop();
        setIsCamOn(false);
        socket?.emit("toggle-cam", false);
      } else {
        // Turning ON: Re-acquire the track
        try {
          const newStream = await navigator.mediaDevices.getUserMedia({ video: true });
          const newTrack = newStream.getVideoTracks()[0];
          
          // Replace in local stream
          localStream.removeTrack(videoTrack);
          localStream.addTrack(newTrack);
          
          // Replace for all peers
          peersRef.current.forEach(p => {
            try {
              p.peer.replaceTrack(videoTrack, newTrack, localStream);
            } catch (e) {
              console.error("Error replacing video track:", e);
            }
          });
          
          setIsCamOn(true);
          socket?.emit("toggle-cam", true);
        } catch (err) {
          toast.error("Could not access camera. Please check permissions.");
        }
      }
    }
  };

  const toggleScreenPause = () => {
    if (isScreenSharing && displayStream) {
      const videoTrack = displayStream.getVideoTracks()[0];
      videoTrack.enabled = !videoTrack.enabled;
      setIsScreenPaused(!videoTrack.enabled);
      socket?.emit("toggle-screen-pause", !videoTrack.enabled);
    }
  };

  const toggleScreenShare = async () => {
    if (!isScreenSharing) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ 
          video: true, 
          audio: true // Enable system audio sharing
        });
        setIsScreenSharing(true);
        setDisplayStream(stream);
        
        const screenTrack = stream.getVideoTracks()[0];
        screenTrackRef.current = screenTrack;

        // Create a combined stream for new peers
        const combinedTracks = [screenTrack];
        const micTrack = localStreamRef.current?.getAudioTracks()[0];
        if (micTrack) combinedTracks.push(micTrack);
        
        const combinedStream = new MediaStream(combinedTracks);
        activeStreamRef.current = combinedStream;
        
        // Replace track for all existing peers
        peersRef.current.forEach(p => {
          const videoTrack = localStreamRef.current?.getVideoTracks()[0];
          if (videoTrack) {
            p.peer.replaceTrack(videoTrack, screenTrack, localStreamRef.current!);
          }
        });

        // Handle user clicking "Stop Sharing" in browser UI
        screenTrack.onended = () => {
          if (screenTrackRef.current) {
            stopScreenShare(screenTrackRef.current);
          }
        };

        toast.success("You are now sharing your screen and audio");
        socket?.emit("screen-share-started");
      } catch (err) {
        console.error("Screen share error:", err);
        toast.error("Could not share screen");
      }
    } else {
      if (screenTrackRef.current) {
        stopScreenShare(screenTrackRef.current);
      }
    }
  };

  const stopScreenShare = (screenTrack: MediaStreamTrack) => {
    setIsScreenSharing(false);
    screenTrack.stop();
    screenTrackRef.current = null;
    setDisplayStream(localStreamRef.current);
    activeStreamRef.current = localStreamRef.current;
    
    const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
    if (cameraTrack) {
      peersRef.current.forEach(p => {
        p.peer.replaceTrack(screenTrack, cameraTrack, localStreamRef.current!);
      });
    }
    toast.info("Screen sharing stopped");
    socket?.emit("screen-share-stopped");
  };

  const toggleHand = () => {
    const newState = !isHandRaised;
    setIsHandRaised(newState);
    socket?.emit("toggle-hand", newState);
  };

  const handleLeave = () => {
    setIsJoined(false);
    setIsVerified(false);
    setUser(null);
    setMessages([]);
    setUsers([]);
    if (socket) socket.disconnect();
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    toast.info("You have left the class.");
  };

  return (
    <div className="min-h-screen bg-[#202124] font-sans text-white overflow-hidden flex flex-col">
      <Toaster position="top-center" theme="dark" />
      
      <AnimatePresence mode="wait">
        {!isVerified ? (
          <motion.div
            key="login"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            className="flex items-center justify-center min-h-screen p-4 bg-slate-50"
          >
            <Login onJoin={handleJoin} />
          </motion.div>
        ) : !isJoined ? (
          <motion.div
            key="prejoin"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="flex items-center justify-center min-h-screen p-4 bg-slate-50"
          >
            <PreJoin 
              stream={localStream || undefined}
              isMicOn={isMicOn}
              isCamOn={isCamOn}
              toggleMic={toggleMic}
              toggleCam={toggleCam}
              onJoin={() => setIsJoined(true)}
              userName={user?.name || ""}
            />
          </motion.div>
        ) : (
          <motion.div
            key="classroom"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col h-screen"
          >
            {/* Header */}
            <header className="h-16 border-b border-slate-800 bg-[#202124] flex items-center justify-between px-6 z-20">
              <div className="flex items-center gap-3">
                <div className="bg-indigo-600 p-2 rounded-lg shadow-lg shadow-indigo-100">
                  <GraduationCap className="text-white w-5 h-5" />
                </div>
                <div>
                  <h1 className="font-black text-white tracking-tight uppercase">Sri Chaitanya SR MPC</h1>
                  <div className="flex items-center gap-2">
                    <span className="flex h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Live Session</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="text-slate-400 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                  onClick={handleLeave}
                >
                  <LogOut className="w-5 h-5" />
                </Button>
              </div>
            </header>

            {/* Main Content Area */}
            <div className="flex-1 flex overflow-hidden relative">
              {/* Video Grid / Stage */}
              <div className="flex-1 p-4 flex flex-col items-center justify-center overflow-hidden">
                {mediaError ? (
                  <Card className="w-full max-w-md bg-slate-800 border-slate-700 text-white">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-red-400">
                        <VideoOff className="w-6 h-6" />
                        Media Access Error
                      </CardTitle>
                      <CardDescription className="text-slate-400">
                        {mediaError === "Permission dismissed" 
                          ? "The permission request was dismissed. Please click the button below to try again."
                          : "We couldn't access your camera or microphone. Please check your browser settings and ensure permissions are allowed for this site."}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                      <div className="bg-slate-900 p-3 rounded-lg text-xs font-mono text-slate-500 break-all">
                        Error: {mediaError}
                      </div>
                      <Button 
                        onClick={() => {
                          setIsJoined(false);
                          setTimeout(() => setIsJoined(true), 100);
                        }}
                        className="bg-indigo-600 hover:bg-indigo-700"
                      >
                        Retry Permissions
                      </Button>
                    </CardContent>
                  </Card>
                ) : (presenterId || pinnedId) ? (
                  // Spotlight Mode
                  <div className="w-full h-full flex flex-col gap-4">
                    <div className="flex-1 relative bg-slate-900 rounded-2xl overflow-hidden border border-indigo-500/30 shadow-2xl">
                      {(() => {
                        const speaker = users.find(u => u.isSpeaking && u.isMicOn);
                        if (speaker) {
                          return (
                            <div className="absolute top-4 right-4 z-10">
                              <Badge className="bg-green-500/80 backdrop-blur-md border-none text-white px-3 py-1 flex items-center gap-2">
                                <div className="flex gap-0.5">
                                  {[1, 2, 3].map(i => (
                                    <motion.div
                                      key={i}
                                      animate={{ height: [4, 12, 4] }}
                                      transition={{ repeat: Infinity, duration: 0.5, delay: i * 0.1 }}
                                      className="w-0.5 bg-white"
                                    />
                                  ))}
                                </div>
                                {speaker.name} is speaking
                              </Badge>
                            </div>
                          );
                        }
                        return null;
                      })()}
                      {(() => {
                        const targetId = presenterId || pinnedId;
                        const targetUser = users.find(u => u.id === targetId);
                        const isTargetPaused = targetUser?.isScreenPaused;

                        if (targetId === socket?.id) {
                          return (
                            <div className="relative w-full h-full">
                              <VideoComponent 
                                stream={displayStream || undefined} 
                                name={user?.name || ""} 
                                role={user?.role || "student"} 
                                handRaised={isHandRaised}
                                isMicOn={isMicOn}
                                isCamOn={isCamOn}
                                isSpeaking={isSpeaking}
                                isLocal={true}
                              />
                              {isScreenPaused && (
                                <div className="absolute inset-0 bg-slate-900/90 flex flex-col items-center justify-center z-20">
                                  <div className="bg-amber-500/20 p-6 rounded-full mb-4">
                                    <MonitorUp className="w-12 h-12 text-amber-500" />
                                  </div>
                                  <h3 className="text-xl font-bold text-white">Screen Share Paused</h3>
                                  <p className="text-slate-400 text-sm mt-2">Others can't see your screen right now</p>
                                </div>
                              )}
                            </div>
                          );
                        }
                        const p = peers.find(peer => peer.peerID === targetId);
                        const u = users.find(user => user.id === targetId);
                        return (
                          <div className="relative w-full h-full">
                            {p ? (
                              <RemoteVideo 
                                peerState={p} 
                                isMicOn={u?.isMicOn}
                                isCamOn={u?.isCamOn}
                                handRaised={u?.handRaised}
                                isSpeaking={u?.isSpeaking}
                              />
                            ) : null}
                            {isTargetPaused && (
                              <div className="absolute inset-0 bg-slate-900/90 flex flex-col items-center justify-center z-20">
                                <div className="bg-indigo-500/20 p-6 rounded-full mb-4">
                                  <MonitorUp className="w-12 h-12 text-indigo-500" />
                                </div>
                                <h3 className="text-xl font-bold text-white">Presentation Paused</h3>
                                <p className="text-slate-400 text-sm mt-2">{u?.name} has paused their screen share</p>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      <div className="absolute top-4 left-4 flex gap-2">
                        {presenterId && (
                          <Badge className="bg-indigo-600/80 backdrop-blur-md border-none text-white px-3 py-1 flex items-center gap-2">
                            <MonitorUp className="w-3 h-3" />
                            {presenterId === pinnedId ? "Pinned Presentation" : "Presenting"}
                          </Badge>
                        )}
                        {pinnedId && pinnedId !== presenterId && (
                          <Badge className="bg-amber-500/80 backdrop-blur-md border-none text-white px-3 py-1 flex items-center gap-2">
                            <Hand className="w-3 h-3" />
                            Pinned
                          </Badge>
                        )}
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-6 px-2 text-[10px] bg-black/20 hover:bg-black/40 text-white border-none rounded-full"
                          onClick={() => {
                            if (presenterId && pinnedId === null) {
                              // If only presenting, we can't really "exit" unless we stop sharing or hide it
                              // But for now, let's just allow pinning someone else
                              setPinnedId(null);
                            } else {
                              setPinnedId(null);
                            }
                          }}
                        >
                          {pinnedId ? "Unpin" : "Exit Spotlight"}
                        </Button>
                      </div>
                    </div>
                    {/* Participant Strip */}
                    <div className="h-32 flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
                      {(() => {
                        const targetId = presenterId || pinnedId;
                        return (
                          <>
                            {targetId !== socket?.id && (
                              <div 
                                className={`w-48 shrink-0 cursor-pointer transition-all rounded-xl overflow-hidden ${pinnedId === socket?.id ? "ring-2 ring-amber-500" : "hover:ring-2 hover:ring-indigo-400"}`}
                                onClick={() => setPinnedId(socket?.id || null)}
                              >
                                <VideoComponent 
                                  stream={localStream || undefined} 
                                  name={user?.name || ""} 
                                  role={user?.role || "student"} 
                                  handRaised={isHandRaised}
                                  isMicOn={isMicOn}
                                  isCamOn={isCamOn}
                                  isSpeaking={isSpeaking}
                                  isLocal={true}
                                />
                              </div>
                            )}
                            {peers.filter(p => p.peerID !== targetId).map((peerState) => {
                              const peerUser = users.find(u => u.id === peerState.peerID);
                              return (
                                <div 
                                  key={peerState.peerID} 
                                  className={`w-48 shrink-0 cursor-pointer transition-all rounded-xl overflow-hidden ${pinnedId === peerState.peerID ? "ring-2 ring-amber-500" : "hover:ring-2 hover:ring-indigo-400"}`}
                                  onClick={() => setPinnedId(peerState.peerID)}
                                >
                                  <RemoteVideo 
                                    peerState={peerState} 
                                    isMicOn={peerUser?.isMicOn}
                                    isCamOn={peerUser?.isCamOn}
                                    handRaised={peerUser?.handRaised}
                                    isSpeaking={peerUser?.isSpeaking}
                                  />
                                </div>
                              );
                            })}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                ) : (
                  // Grid Mode
                  <div className={`grid gap-4 w-full max-w-6xl mx-auto ${
                    peers.length === 0 ? "grid-cols-1" : 
                    peers.length === 1 ? "grid-cols-1 md:grid-cols-2" : 
                    peers.length === 2 ? "grid-cols-1 md:grid-cols-3" : 
                    "grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
                  }`}>
                    {(() => {
                      const speaker = users.find(u => u.isSpeaking && u.isMicOn);
                      if (speaker && speaker.id !== socket?.id) {
                        return (
                          <div className="col-span-full flex justify-center mb-2">
                            <Badge className="bg-green-500/80 backdrop-blur-md border-none text-white px-4 py-1.5 flex items-center gap-3 shadow-lg">
                              <div className="flex gap-1">
                                {[1, 2, 3, 4].map(i => (
                                  <motion.div
                                    key={i}
                                    animate={{ height: [4, 16, 4] }}
                                    transition={{ repeat: Infinity, duration: 0.5, delay: i * 0.1 }}
                                    className="w-1 bg-white rounded-full"
                                  />
                                ))}
                              </div>
                              <span className="font-bold tracking-wide">{speaker.name} is speaking</span>
                            </Badge>
                          </div>
                        );
                      }
                      return null;
                    })()}
                    <div 
                      className="cursor-pointer"
                      onClick={() => setPinnedId(socket?.id || null)}
                    >
                      <VideoComponent 
                        stream={displayStream || undefined} 
                        name={user?.name || ""} 
                        role={user?.role || "student"} 
                        handRaised={isHandRaised}
                        isMicOn={isMicOn}
                        isCamOn={isCamOn}
                        isSpeaking={isSpeaking}
                        isLocal={true}
                      />
                    </div>
                    {peers.map((peerState) => {
                      const peerUser = users.find(u => u.id === peerState.peerID);
                      return (
                        <div 
                          key={peerState.peerID}
                          className="cursor-pointer"
                          onClick={() => setPinnedId(peerState.peerID)}
                        >
                          <RemoteVideo 
                            peerState={peerState} 
                            isMicOn={peerUser?.isMicOn}
                            isCamOn={peerUser?.isCamOn}
                            handRaised={peerUser?.handRaised}
                            isSpeaking={peerUser?.isSpeaking}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Side Panel (Chat/People) */}
              <AnimatePresence>
                {sidePanel && (
                  <motion.aside
                    initial={{ x: 400 }}
                    animate={{ x: 0 }}
                    exit={{ x: 400 }}
                    className="w-96 bg-white text-slate-900 m-4 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
                  >
                    <div className="p-4 flex items-center justify-between border-b">
                      <h2 className="font-semibold text-lg capitalize">{sidePanel}</h2>
                      <Button variant="ghost" size="icon" onClick={() => setSidePanel(null)} className="rounded-full">
                        <ChevronRight className="w-5 h-5" />
                      </Button>
                    </div>
                    
                    <div className="flex-1 overflow-hidden">
                      {sidePanel === "chat" ? (
                        <Chat messages={messages} onSendMessage={(text) => socket?.emit("send-message", { text })} currentUser={user?.name} />
                      ) : sidePanel === "people" ? (
                        <Participants 
                          users={users} 
                          onKick={(id) => socket?.emit("kick-student", id)} 
                          isTeacher={user?.role === "teacher"}
                          currentUserId={socket?.id}
                        />
                      ) : (
                        <Polls 
                          polls={polls} 
                          onVote={(pollId, optionIndex) => socket?.emit("vote-poll", { pollId, optionIndex })}
                          onCreate={(pollData) => socket?.emit("create-poll", pollData)}
                          onEnd={(pollId) => socket?.emit("end-poll", pollId)}
                          isTeacher={user?.role === "teacher"}
                          currentUserId={socket?.id || ""}
                        />
                      )}
                    </div>
                  </motion.aside>
                )}
              </AnimatePresence>
            </div>

            {/* Bottom Control Bar */}
            <div className="h-20 bg-[#202124] px-6 flex items-center justify-between">
              <div className="flex items-center gap-4 w-1/4">
                <div className="hidden md:block">
                  <p className="text-sm font-medium">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} | Class Session</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <ControlButton 
                  icon={isMicOn ? Mic : MicOff} 
                  active={isMicOn} 
                  onClick={toggleMic} 
                  variant={isMicOn ? "secondary" : "destructive"}
                />
                <ControlButton 
                  icon={isCamOn ? Video : VideoOff} 
                  active={isCamOn} 
                  onClick={toggleCam} 
                  variant={isCamOn ? "secondary" : "destructive"}
                />
                <ControlButton 
                  icon={Hand} 
                  active={isHandRaised} 
                  onClick={toggleHand} 
                  variant={isHandRaised ? "warning" : "secondary"}
                />
                <ControlButton 
                  icon={MonitorUp} 
                  active={isScreenSharing} 
                  onClick={toggleScreenShare} 
                  variant={isScreenSharing ? "warning" : "secondary"}
                />
                {isScreenSharing && (
                  <ControlButton 
                    icon={isScreenPaused ? PlayCircle : PauseCircle} 
                    active={isScreenPaused} 
                    onClick={toggleScreenPause} 
                    variant={isScreenPaused ? "destructive" : "warning"}
                    title={isScreenPaused ? "Resume Share" : "Pause Share"}
                  />
                )}
                <ControlButton 
                  icon={PhoneOff} 
                  onClick={handleLeave} 
                  variant="destructive"
                  className="px-6 rounded-full"
                />
              </div>

              <div className="flex items-center justify-end gap-2 w-1/4">
                <Button variant="ghost" size="icon" onClick={() => setSidePanel(sidePanel === "people" ? null : "people")} className={`rounded-full ${sidePanel === "people" ? "bg-indigo-600/20 text-indigo-400" : ""}`}>
                  <Users className="w-5 h-5" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setSidePanel(sidePanel === "polls" ? null : "polls")} className={`rounded-full ${sidePanel === "polls" ? "bg-indigo-600/20 text-indigo-400" : ""}`}>
                  <BarChart2 className="w-5 h-5" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setSidePanel(sidePanel === "chat" ? null : "chat")} className={`rounded-full ${sidePanel === "chat" ? "bg-indigo-600/20 text-indigo-400" : ""}`}>
                  <MessageSquare className="w-5 h-5" />
                </Button>
                <Button variant="ghost" size="icon" className="rounded-full">
                  <Settings className="w-5 h-5" />
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Sub-components ---

function RemoteVideo({ peerState, isMicOn, isCamOn, handRaised, isSpeaking }: any) {
  const [stream, setStream] = useState<MediaStream | undefined>();
  
  useEffect(() => {
    peerState.peer.on("stream", (s: MediaStream) => {
      setStream(s);
    });
  }, [peerState.peer]);

  return (
    <VideoComponent 
      stream={stream} 
      name={peerState.name} 
      role={peerState.role} 
      isMicOn={isMicOn}
      isCamOn={isCamOn}
      handRaised={handRaised}
      isSpeaking={isSpeaking}
    />
  );
}

function ControlButton({ icon: Icon, active, onClick, variant = "secondary", className }: any) {
  const variants: any = {
    secondary: "bg-slate-800 hover:bg-slate-700 text-white",
    destructive: "bg-red-500 hover:bg-red-600 text-white",
    warning: "bg-amber-400 hover:bg-amber-500 text-white",
  };

  return (
    <Button 
      variant="ghost" 
      size="icon" 
      onClick={onClick}
      className={`rounded-full w-12 h-12 transition-all ${variants[variant]} ${className}`}
    >
      <Icon className="w-5 h-5" />
    </Button>
  );
}

function Login({ onJoin }: { onJoin: (name: string, admissionNo: string, role: "teacher" | "student", idCode?: string) => void }) {
  const [role, setRole] = useState<"teacher" | "student" | "register">("student");
  const [name, setName] = useState("");
  const [admissionNo, setAdmissionNo] = useState("");
  const [idCode, setIdCode] = useState("");
  const [adminCode, setAdminCode] = useState("");
  const [bulkData, setBulkData] = useState(""); // For bulk registration
  const [registerType, setRegisterType] = useState<"student" | "teacher">("student");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (role === "register") {
      handleRegister();
      return;
    }
    if (!name.trim()) return toast.error("Please enter your name");
    if (role === "student" && !admissionNo.trim()) return toast.error("Please enter admission number");
    if (role === "teacher" && !idCode.trim()) return toast.error("Please enter teacher ID code");
    onJoin(name.trim(), admissionNo.trim(), role as any, idCode.trim());
  };

  const handleRegister = async () => {
    if (!adminCode.trim()) return toast.error("Please enter Admin Secret Code");
    if (!bulkData.trim()) return toast.error("Please enter student data");

    const lines = bulkData.split("\n").filter(line => line.trim());
    const students = lines.map(line => {
      const parts = line.split(",");
      return {
        name: parts[0]?.trim(),
        admissionNo: parts[1]?.trim()
      };
    }).filter(s => s.name && s.admissionNo);

    if (students.length === 0) return toast.error("Invalid student data format. Use: Name, AdmissionNo");

    try {
      const endpoint = registerType === "student" ? "/api/add-student" : "/api/add-teacher";
      const payload = registerType === "student" 
        ? { students, adminCode: adminCode.trim() }
        : { teachers: students.map(s => ({ name: s.name, idCode: s.admissionNo })), adminCode: adminCode.trim() };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (data.success) {
        toast.success(data.message);
        setRole(registerType);
        setBulkData("");
        setAdminCode("");
      } else {
        toast.error(data.message);
      }
    } catch (err) {
      toast.error("Registration failed");
    }
  };

  return (
    <div className="flex flex-col items-center gap-8">
      <Card className="w-full max-w-md border-none shadow-2xl bg-white/90 backdrop-blur-xl">
        <CardHeader className="text-center space-y-1">
          <div className="mx-auto bg-indigo-600 w-16 h-16 rounded-2xl flex items-center justify-center mb-4 shadow-xl shadow-indigo-200 rotate-3">
            <GraduationCap className="text-white w-9 h-9" />
          </div>
          <CardTitle className="text-4xl font-black tracking-tighter text-slate-900 uppercase">Sri Chaitanya SR MPC</CardTitle>
          <CardDescription className="text-slate-500 font-medium tracking-tight">Secure Virtual Classroom</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={role} onValueChange={(v) => setRole(v as any)} className="w-full mb-8">
            <TabsList className="grid w-full grid-cols-3 bg-slate-100 p-1 rounded-xl">
              <TabsTrigger value="student" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-md font-semibold">Student</TabsTrigger>
              <TabsTrigger value="teacher" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-md font-semibold">Teacher</TabsTrigger>
              <TabsTrigger value="register" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-md font-semibold">Register</TabsTrigger>
            </TabsList>
          </Tabs>

          <form onSubmit={handleSubmit} className="space-y-5">
            {role !== "register" && (
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Full Name</label>
                <div className="relative">
                  <User className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="Enter name"
                    className="pl-11 h-12 bg-slate-50 border-slate-200 focus:ring-2 focus:ring-indigo-500 rounded-xl"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
              </div>
            )}

            {role === "student" && (
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Admission Number</label>
                <div className="relative">
                  <ShieldCheck className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="Enter admission number"
                    className="pl-11 h-12 bg-slate-50 border-slate-200 focus:ring-2 focus:ring-indigo-500 rounded-xl"
                    value={admissionNo}
                    onChange={(e) => setAdmissionNo(e.target.value)}
                  />
                </div>
              </div>
            )}

            {role === "teacher" && (
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Teacher ID Code</label>
                <div className="relative">
                  <ShieldCheck className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
                  <Input
                    type="password"
                    placeholder="Enter ID code"
                    className="pl-11 h-12 bg-slate-50 border-slate-200 focus:ring-2 focus:ring-indigo-500 rounded-xl"
                    value={idCode}
                    onChange={(e) => setIdCode(e.target.value)}
                  />
                </div>
              </div>
            )}

            {role === "register" && (
              <>
                <div className="flex gap-2 mb-4">
                  <Button 
                    type="button"
                    variant={registerType === "student" ? "default" : "outline"}
                    className="flex-1 rounded-xl h-10 text-xs font-bold"
                    onClick={() => setRegisterType("student")}
                  >
                    Register Students
                  </Button>
                  <Button 
                    type="button"
                    variant={registerType === "teacher" ? "default" : "outline"}
                    className="flex-1 rounded-xl h-10 text-xs font-bold"
                    onClick={() => setRegisterType("teacher")}
                  >
                    Register Teachers
                  </Button>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                    {registerType === "student" ? "Bulk Student Data (Name, AdmissionNo)" : "Bulk Teacher Data (Name, IDCode)"}
                  </label>
                  <textarea
                    placeholder={registerType === "student" ? "Vamshi, 101\nAditya, 102" : "Vamshi, vamshi018"}
                    className="w-full h-32 p-3 bg-slate-50 border border-slate-200 focus:ring-2 focus:ring-indigo-500 rounded-xl text-sm text-slate-900 resize-none"
                    value={bulkData}
                    onChange={(e) => setBulkData(e.target.value)}
                  />
                  <p className="text-[10px] text-slate-400 italic">
                    {registerType === "student" ? "Enter one student per line: Name, AdmissionNo" : "Enter one teacher per line: Name, IDCode"}
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Admin Secret Code</label>
                  <div className="relative">
                    <ShieldCheck className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
                    <Input
                      type="password"
                      placeholder="Enter code"
                      className="pl-11 h-12 bg-slate-50 border-slate-200 focus:ring-2 focus:ring-indigo-500 rounded-xl"
                      value={adminCode}
                      onChange={(e) => setAdminCode(e.target.value)}
                    />
                  </div>
                </div>
              </>
            )}

            <Button type="submit" className="w-full h-12 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-lg rounded-xl transition-all shadow-lg shadow-indigo-100 mt-2">
              {role === "register" ? "Add Students" : "Verify Details"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function PreJoin({ stream, isMicOn, isCamOn, toggleMic, toggleCam, onJoin, userName }: any) {
  return (
    <Card className="w-full max-w-2xl border-none shadow-2xl bg-white/90 backdrop-blur-xl overflow-hidden">
      <div className="flex flex-col md:flex-row h-full">
        <div className="flex-1 bg-slate-900 p-6 flex flex-col items-center justify-center gap-6">
          <div className="w-full aspect-video rounded-xl overflow-hidden bg-slate-800 relative flex items-center justify-center border border-slate-700 shadow-inner">
            {isCamOn && stream ? (
              <VideoPreview stream={stream} />
            ) : (
              <div className="w-24 h-24 rounded-full bg-indigo-600 flex items-center justify-center text-white text-4xl font-bold shadow-lg">
                {userName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-4">
              <ControlButton 
                icon={isMicOn ? Mic : MicOff} 
                active={isMicOn} 
                onClick={toggleMic} 
                variant={isMicOn ? "secondary" : "destructive"}
                className="w-10 h-10 shadow-xl"
              />
              <ControlButton 
                icon={isCamOn ? Video : VideoOff} 
                active={isCamOn} 
                onClick={toggleCam} 
                variant={isCamOn ? "secondary" : "destructive"}
                className="w-10 h-10 shadow-xl"
              />
            </div>
          </div>
          <p className="text-slate-400 text-sm font-medium">Check your audio and video before joining</p>
        </div>
        <div className="w-full md:w-72 p-8 flex flex-col justify-center gap-6">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Ready to join?</h2>
            <p className="text-slate-500 text-sm">You're verified as <span className="font-bold text-indigo-600">{userName}</span></p>
          </div>
          <Button 
            onClick={onJoin}
            className="w-full h-12 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-lg rounded-xl transition-all shadow-lg shadow-indigo-100"
          >
            Join Now
          </Button>
          <div className="flex items-center gap-2 text-slate-400 text-xs justify-center">
            <ShieldCheck className="w-3 h-3" />
            <span>Secure Connection Active</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

function VideoPreview({ stream }: { stream: MediaStream }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className="w-full h-full object-cover"
    />
  );
}

function Chat({ messages, onSendMessage, currentUser }: { messages: Message[]; onSendMessage: (text: string) => void; currentUser?: string }) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth"
      });
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      onSendMessage(input);
      setInput("");
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${
                msg.type === "system"
                  ? "items-center"
                  : msg.sender === currentUser
                  ? "items-end"
                  : "items-start"
              }`}
            >
              {msg.type === "system" ? (
                <span className="text-[9px] bg-slate-200 text-slate-500 px-3 py-1 rounded-full uppercase tracking-widest font-bold my-2">
                  {msg.text}
                </span>
              ) : (
                <div className={`max-w-[85%] space-y-1 ${msg.sender === currentUser ? "items-end" : "items-start"}`}>
                  <div className="flex items-center gap-2 px-1">
                    <span className="text-[10px] font-bold text-slate-600">{msg.sender}</span>
                    {msg.role && (
                      <Badge className={`text-[8px] px-1 h-3.5 uppercase ${msg.role === 'teacher' ? 'bg-amber-500' : 'bg-indigo-500'}`}>
                        {msg.role}
                      </Badge>
                    )}
                    <span className="text-[9px] text-slate-400">{msg.timestamp}</span>
                  </div>
                  <div
                    className={`px-4 py-2 rounded-2xl text-sm shadow-sm ${
                      msg.sender === currentUser
                        ? "bg-indigo-600 text-white rounded-tr-none"
                        : "bg-white text-slate-800 rounded-tl-none border border-slate-100"
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
      <div className="p-4 border-t bg-white">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            placeholder="Type a message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 bg-slate-50 border-slate-200 rounded-xl px-4 h-10 focus:ring-indigo-500"
          />
          <Button type="submit" size="icon" className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shrink-0 h-10 w-10">
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}

function Polls({ 
  polls, 
  onVote, 
  onCreate, 
  onEnd, 
  isTeacher, 
  currentUserId 
}: { 
  polls: Poll[]; 
  onVote: (pollId: string, optionIndex: number) => void;
  onCreate: (pollData: { question: string; options: string[] }) => void;
  onEnd: (pollId: string) => void;
  isTeacher: boolean;
  currentUserId: string;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (question.trim() && options.every(opt => opt.trim())) {
      onCreate({ question, options });
      setQuestion("");
      setOptions(["", ""]);
      setShowCreate(false);
    } else {
      toast.error("Please fill in all fields");
    }
  };

  const addOption = () => setOptions([...options, ""]);
  const removeOption = (index: number) => setOptions(options.filter((_, i) => i !== index));

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <div className="p-4 border-b bg-white flex items-center justify-between">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Active Polls</span>
        {isTeacher && (
          <Button 
            size="sm" 
            variant={showCreate ? "ghost" : "default"} 
            className="h-8 rounded-lg gap-2"
            onClick={() => setShowCreate(!showCreate)}
          >
            {showCreate ? "Cancel" : <><PlusCircle className="w-4 h-4" /> Create Poll</>}
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1 p-4">
        {showCreate && isTeacher && (
          <Card className="mb-6 border-indigo-100 shadow-md">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-bold">New Poll</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Question</label>
                <Input 
                  placeholder="What's your question?" 
                  value={question} 
                  onChange={(e) => setQuestion(e.target.value)}
                  className="bg-slate-50 border-slate-200"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Options</label>
                {options.map((opt, i) => (
                  <div key={i} className="flex gap-2">
                    <Input 
                      placeholder={`Option ${i + 1}`} 
                      value={opt} 
                      onChange={(e) => {
                        const newOpts = [...options];
                        newOpts[i] = e.target.value;
                        setOptions(newOpts);
                      }}
                      className="bg-slate-50 border-slate-200"
                    />
                    {options.length > 2 && (
                      <Button variant="ghost" size="icon" onClick={() => removeOption(i)} className="text-red-400 hover:text-red-500 hover:bg-red-50">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addOption} className="w-full border-dashed border-slate-300 text-slate-500 hover:bg-slate-50">
                  + Add Option
                </Button>
              </div>
              <Button onClick={handleCreate} className="w-full bg-indigo-600 hover:bg-indigo-700">Launch Poll</Button>
            </CardContent>
          </Card>
        )}

        <div className="space-y-4">
          {polls.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <BarChart2 className="w-12 h-12 mb-2 opacity-20" />
              <p className="text-sm font-medium">No active polls</p>
            </div>
          ) : (
            [...polls].reverse().map((poll) => {
              const totalVotes = poll.options.reduce((acc, opt) => acc + opt.votes.length, 0);
              const hasVoted = poll.options.some(opt => opt.votes.includes(currentUserId));

              return (
                <Card key={poll.id} className={`overflow-hidden border-none shadow-sm ${!poll.isActive ? 'opacity-75 grayscale-[0.5]' : ''}`}>
                  <CardHeader className="p-4 pb-2 bg-white">
                    <div className="flex items-center justify-between mb-1">
                      <Badge variant={poll.isActive ? "default" : "secondary"} className="text-[8px] h-4">
                        {poll.isActive ? "Active" : "Ended"}
                      </Badge>
                      <span className="text-[9px] text-slate-400">{poll.timestamp}</span>
                    </div>
                    <CardTitle className="text-sm font-bold text-slate-800">{poll.question}</CardTitle>
                    <CardDescription className="text-[10px]">Created by {poll.creatorName}</CardDescription>
                  </CardHeader>
                  <CardContent className="p-4 pt-2 bg-white space-y-3">
                    {poll.options.map((opt, i) => {
                      const percentage = totalVotes > 0 ? Math.round((opt.votes.length / totalVotes) * 100) : 0;
                      const isSelected = opt.votes.includes(currentUserId);

                      return (
                        <div key={i} className="space-y-1">
                          <button
                            disabled={!poll.isActive}
                            onClick={() => onVote(poll.id, i)}
                            className={`w-full text-left p-2 rounded-lg text-xs font-medium transition-all border ${
                              isSelected 
                                ? "bg-indigo-50 border-indigo-200 text-indigo-700" 
                                : "bg-slate-50 border-slate-100 text-slate-600 hover:border-slate-200"
                            } ${!poll.isActive ? 'cursor-default' : ''}`}
                          >
                            <div className="flex justify-between items-center">
                              <span>{opt.text}</span>
                              {hasVoted && <span className="font-bold">{percentage}%</span>}
                            </div>
                          </button>
                          {hasVoted && (
                            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                              <motion.div 
                                initial={{ width: 0 }}
                                animate={{ width: `${percentage}%` }}
                                className={`h-full ${isSelected ? 'bg-indigo-500' : 'bg-slate-300'}`}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-50">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{totalVotes} Votes</span>
                      {isTeacher && poll.isActive && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-7 text-[10px] text-red-500 hover:text-red-600 hover:bg-red-50 font-bold"
                          onClick={() => onEnd(poll.id)}
                        >
                          End Poll
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function Participants({ users, onKick, isTeacher, currentUserId }: { users: UserData[]; onKick: (id: string) => void; isTeacher: boolean; currentUserId?: string }) {
  return (
    <ScrollArea className="h-full p-4">
      <div className="space-y-4">
        {users.map((u) => (
          <div key={u.id} className="flex items-center justify-between group">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
                u.role === "teacher" ? "bg-amber-100 text-amber-700" : "bg-indigo-100 text-indigo-700"
              }`}>
                {u.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-bold text-slate-800">{u.name}</span>
                <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">{u.role}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {u.isSpeaking && u.isMicOn && (
                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ repeat: Infinity, duration: 1 }}
                  className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.8)]"
                />
              )}
              {!u.isMicOn && <MicOff className="w-3.5 h-3.5 text-red-500" />}
              {!u.isCamOn && <VideoOff className="w-3.5 h-3.5 text-red-500" />}
              {u.handRaised && (
                <div className="bg-amber-400 p-1 rounded-full">
                  <Hand className="w-3 h-3 text-white fill-white" />
                </div>
              )}
              {u.role === "teacher" && <ShieldCheck className="w-4 h-4 text-amber-500" />}
              
              {isTeacher && u.role === "student" && u.id !== currentUserId && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-8 h-8 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => onKick(u.id)}
                >
                  <UserX className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
