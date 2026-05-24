import { useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Link, useParams, useNavigate, Navigate, useLocation } from "react-router-dom";
import { onAuthStateChanged, signInWithPopup, signOut, User } from "firebase/auth";
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc, 
  updateDoc, 
  serverTimestamp, 
  query, 
  orderBy,
  limit,
  getDoc,
  getDocs,
  setDoc,
  arrayUnion,
  arrayRemove,
  where,
  writeBatch
} from "firebase/firestore";
import ReactPlayer from "react-player";
import { auth, googleProvider, db, OperationType, handleFirestoreError } from "./lib/firebase";
import { Home, Play, Search, User as UserIcon, LogOut, Star, TrendingUp, Menu, X, ChevronLeft, ChevronRight, Apple, Settings, Plus, Trash2, Edit2, Save, Heart, Bell, Clock, History, ShieldCheck, Users, HelpCircle, MessageSquare, Upload } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { motion, AnimatePresence } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

// Types
interface CastMember {
  name: string;
  role: string;
  imageUrl?: string;
}

interface Review {
  id: string;
  userId: string;
  userName: string;
  userPhoto?: string;
  rating: number;
  comment: string;
  createdAt: string;
}

interface Episode {
  id: string;
  episodeNumber: number;
  titleKu?: string;
  titleEn?: string;
  duration?: string;
  qualities: { label: string; url: string }[];
  subtitles?: { label: string; lang: string; url: string }[];
}

interface Season {
  id: string;
  seasonNumber: number;
  titleKu?: string;
  titleEn?: string;
  episodes: Episode[];
}

interface Movie {
  id: string;
  titleKu: string;
  titleEn: string;
  description: string;
  posterUrl: string;
  bannerUrl: string;
  category: string;
  rating: number;
  year: number;
  duration: string;
  trailerUrl?: string;
  qualities: { label: string; url: string }[];
  subtitles?: { label: string; lang: string; url: string }[];
  cast?: CastMember[];
  reviews?: Review[];
  isFeatured?: boolean;
  bannerAlignment?: "left" | "right" | "center";
  contentType?: "movie" | "series";
  seasons?: Season[];
}

interface WatchHistoryItem {
  movieId: string;
  watchedAt: any;
  progress?: number;
}

// Context/State would go here, using simple state for now
function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [watchHistory, setWatchHistory] = useState<WatchHistoryItem[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [authReady, setAuthReady] = useState(false);
  const [moviesReady, setMoviesReady] = useState(false);
  const [movies, setMovies] = useState<Movie[]>([]);
  const [status, setStatus] = useState<{ type: "success" | "error" | null; message: string }>({ type: null, message: "" });

  const isAppDataReady = authReady && moviesReady;

  useEffect(() => {
    if (status.type) {
      const timer = setTimeout(() => setStatus({ type: null, message: "" }), 5000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  useEffect(() => {
    let unsubscribeUserDoc: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // Ensure user document exists in Firestore
        const userDocRef = doc(db, "users", u.uid);
        try {
          const userSnap = await getDoc(userDocRef);
          if (!userSnap.exists()) {
            await setDoc(userDocRef, {
              uid: u.uid,
              email: u.email,
              displayName: u.displayName,
              photoURL: u.photoURL,
              favorites: [],
              watchHistory: [],
              notifications: [
                {
                  id: "welcome",
                  title: "بەخێربێیت بۆ شیای سینەما!",
                  message: "چێژ لە بینینی هەزاران فیلم و زنجیرە وەربگرە بە کوالێتی بەرز.",
                  read: false,
                  createdAt: new Date().toISOString()
                }
              ],
              createdAt: serverTimestamp()
            });
          }
        } catch (e) {
          console.error("Error ensuring user profile", e);
        }

        // Listen to user document for favorites and history
        unsubscribeUserDoc = onSnapshot(userDocRef, (doc) => {
          if (doc.exists()) {
            const data = doc.data();
            setFavorites(data.favorites || []);
            setWatchHistory(data.watchHistory || []);
            setNotifications(data.notifications || []);
          }
        }, (error) => {
          handleFirestoreError(error, OperationType.GET, `users/${u.uid}`);
        });

        // Double check admin status
        const ownerEmail = "abubakrsleman4@gmail.com";
        const userEmail = u.email?.toLowerCase();
        
        if (userEmail === ownerEmail) {
          setIsAdmin(true);
          setIsOwner(true);
          // Also ensure they have a document in the admins collection for the security rules
          try {
            const adminDocRef = doc(db, "admins", u.uid);
            const adminSnap = await getDoc(adminDocRef);
            if (!adminSnap.exists()) {
              await setDoc(adminDocRef, {
                email: u.email,
                displayName: u.displayName,
                role: "owner",
                addedAt: serverTimestamp()
              });
            }
          } catch (e) {
            console.error("Error syncing admin doc", e);
          }
        } else {
          setIsOwner(false);
          try {
            const adminDoc = await getDoc(doc(db, "admins", u.uid));
            setIsAdmin(adminDoc.exists());
          } catch (e) {
            console.error("Error checking admin status", e);
            setIsAdmin(false);
          }
        }
      } else {
        setIsAdmin(false);
        setIsOwner(false);
        setFavorites([]);
        if (unsubscribeUserDoc) unsubscribeUserDoc();
      }
      setAuthReady(true);
    });

    // Real-time movies listener
    const unsubscribeMovies = onSnapshot(
      query(collection(db, "movies"), orderBy("year", "desc")), 
      (snapshot) => {
        const moviesList = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Movie[];
        setMovies(moviesList);
        setMoviesReady(true);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, "movies");
        setMoviesReady(true); // Still set to ready so app doesn't hang
      }
    );

    return () => {
      unsubscribeAuth();
      unsubscribeMovies();
    };
  }, []);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  const toggleFavorite = async (movieId: string) => {
    if (!user) return;
    const userDocRef = doc(db, "users", user.uid);
    const isFavorite = favorites.includes(movieId);

    try {
      await updateDoc(userDocRef, {
        favorites: isFavorite ? arrayRemove(movieId) : arrayUnion(movieId)
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const addToHistory = async (movieId: string) => {
    if (!user) return;
    const userDocRef = doc(db, "users", user.uid);
    
    // Remove existing entry for this movie if any
    const newHistory = watchHistory.filter(h => h.movieId !== movieId);
    // Add new entry at start
    const updatedHistory = [
      { movieId, watchedAt: new Date().toISOString(), progress: 0 },
      ...newHistory
    ].slice(0, 20); // Keep last 20

    try {
      await updateDoc(userDocRef, {
        watchHistory: updatedHistory
      });
    } catch (error) {
      console.error("Error updating history", error);
    }
  };

  const markNotificationRead = async (notifId: string) => {
    if (!user) return;
    const userDocRef = doc(db, "users", user.uid);
    const updatedNotifs = notifications.map(n => n.id === notifId ? { ...n, read: true } : n);
    
    try {
      await updateDoc(userDocRef, { notifications: updatedNotifs });
    } catch (error) {
      console.error("Error marking notification read", error);
    }
  };

  const addReview = async (movieId: string, rating: number, comment: string) => {
    if (!user) return;
    const reviewsRef = collection(db, "movies", movieId, "reviews");

    try {
      await addDoc(reviewsRef, {
        userId: user.uid,
        userName: user.displayName || "Anonymous",
        userPhoto: user.photoURL || undefined,
        rating,
        comment,
        createdAt: serverTimestamp()
      });
      setStatus({ type: "success", message: "ڕاکەت بە سەرکەوتوویی زیادکرا" });
    } catch (error) {
      console.error("Error adding review", error);
      setStatus({ type: "error", message: "هەڵەیەک ڕوویدا لە زیادکردنی ڕاکەت" });
    }
  };

  if (!isAppDataReady) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0a0a0a] text-white">
        <motion.div 
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
          className="text-primary text-4xl font-bold flex flex-col items-center gap-4"
        >
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
          <span className="font-sans tracking-widest text-gold-500">SHEA CINEMA</span>
        </motion.div>
      </div>
    );
  }

  return (
    <Router>
      <AppContent 
        user={user} 
        isAdmin={isAdmin} 
        isOwner={isOwner}
        handleLogin={handleLogin}
        handleLogout={handleLogout}
        notifications={notifications}
        movies={movies}
        favorites={favorites}
        watchHistory={watchHistory}
        toggleFavorite={toggleFavorite}
        setStatus={setStatus}
        status={status}
        addToHistory={addToHistory}
        addReview={addReview}
        showChangelog={showChangelog}
        setShowChangelog={setShowChangelog}
        showRequestModal={showRequestModal}
        setShowRequestModal={setShowRequestModal}
      />
    </Router>
  );
}

function PageWrapper({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

function AppContent({ 
  user, isAdmin, isOwner, handleLogin, handleLogout, notifications, 
  movies, favorites, watchHistory, toggleFavorite, setStatus, status,
  addToHistory, addReview, showChangelog, setShowChangelog,
  showRequestModal, setShowRequestModal
}: any) {
  const location = useLocation();
  const [confirmConfig, setConfirmConfig] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel?: () => void;
  } | null>(null);

  const showConfirm = (title: string, message: string, onConfirm: () => void, onCancel?: () => void) => {
    setConfirmConfig({ title, message, onConfirm, onCancel });
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-primary/30" dir="rtl">
      <Navbar user={user} isAdmin={isAdmin} onLogin={handleLogin} onLogout={handleLogout} notifications={notifications} onOpenRequest={() => setShowRequestModal(true)} />
      
      <AnimatePresence mode="wait">
        {status.type && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-24 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 backdrop-blur-md border ${
              status.type === "success" ? "bg-green-500/20 border-green-500/50 text-green-200" : "bg-destructive/20 border-destructive/50 text-destructive-foreground"
            }`}
          >
            {status.type === "success" ? <Star className="w-5 h-5 fill-current" /> : <X className="w-5 h-5" />}
            <span className="font-bold">{status.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="pt-20">
        <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            <Route path="/" element={<PageWrapper><HomePage movies={movies} favorites={favorites} watchHistory={watchHistory} toggleFavorite={toggleFavorite} isAdmin={isAdmin} setStatus={setStatus} /></PageWrapper>} />
            <Route path="/movie/:id" element={<PageWrapper><MoviePage movies={movies} user={user} favorites={favorites} toggleFavorite={toggleFavorite} setStatus={setStatus} addToHistory={addToHistory} addReview={addReview} isAdmin={isAdmin} showConfirm={showConfirm} /></PageWrapper>} />
            <Route path="/search" element={<PageWrapper><SearchPage movies={movies} favorites={favorites} toggleFavorite={toggleFavorite} onRequestMovie={() => setShowRequestModal(true)} /></PageWrapper>} />
            <Route path="/movies" element={<PageWrapper><SearchPage movies={movies} favorites={favorites} toggleFavorite={toggleFavorite} onRequestMovie={() => setShowRequestModal(true)} initialCategory="Action" /></PageWrapper>} />
            <Route path="/series" element={<PageWrapper><SearchPage movies={movies} favorites={favorites} toggleFavorite={toggleFavorite} onRequestMovie={() => setShowRequestModal(true)} initialCategory="Drama" /></PageWrapper>} />
            <Route path="/kurdish" element={<PageWrapper><SearchPage movies={movies} favorites={favorites} toggleFavorite={toggleFavorite} onRequestMovie={() => setShowRequestModal(true)} initialCategory="Kurdish" /></PageWrapper>} />
            <Route path="/account" element={<PageWrapper><AccountPage user={user} movies={movies} favorites={favorites} onLogin={handleLogin} onLogout={handleLogout} toggleFavorite={toggleFavorite} /></PageWrapper>} />
            <Route 
              path="/admin" 
              element={isAdmin ? <PageWrapper><AdminPage movies={movies} setStatus={setStatus} isOwner={isOwner} showConfirm={showConfirm} /></PageWrapper> : <Navigate to="/" />} 
            />
          </Routes>
        </AnimatePresence>
      </main>

      {showChangelog && <ChangelogModal onClose={() => setShowChangelog(false)} />}
      {showRequestModal && <RequestMovieModal user={user} onClose={() => setShowRequestModal(false)} setStatus={setStatus} />}
      
      {/* Premium Confirm Custom Modal with animations */}
      <AnimatePresence>
        {confirmConfig && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="bg-[#1a1a1a] border border-white/10 rounded-3xl p-6 max-w-md w-full text-right space-y-6 shadow-2xl relative"
              dir="rtl"
            >
              <div className="space-y-3">
                <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-500 mb-2">
                  <Trash2 className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold text-white pr-1">{confirmConfig.title}</h3>
                <p className="text-sm text-white/65 leading-relaxed pr-1">{confirmConfig.message}</p>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <Button 
                  variant="outline" 
                  className="rounded-xl border-white/10 hover:bg-white/5 font-bold px-5 h-11 text-xs"
                  onClick={() => {
                    if (confirmConfig.onCancel) confirmConfig.onCancel();
                    setConfirmConfig(null);
                  }}
                >
                  پەشیمانبوونەوە
                </Button>
                <Button 
                  className="rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold px-5 h-11 text-xs shadow-lg shadow-red-500/10"
                  onClick={() => {
                    confirmConfig.onConfirm();
                    setConfirmConfig(null);
                  }}
                >
                  دڵنیام، بسڕەوە
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <Footer onShowChangelog={() => setShowChangelog(true)} />
    </div>
  );
}

// Components
function Navbar({ user, isAdmin, onLogin, onLogout, notifications, onOpenRequest }: { user: User | null; isAdmin: boolean; onLogin: () => void; onLogout: () => void; notifications: any[]; onOpenRequest: () => void }) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${isScrolled ? "bg-[#0a0a0a]/95 backdrop-blur-md py-3 shadow-2xl" : "bg-transparent py-5"}`}>
      <div className="max-w-7xl mx-auto px-4 md:px-8 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link to="/" className="flex items-center gap-2 group">
             {/* Styled SVG Logo for Shea Cinema */}
            <div className="bg-primary p-2 rounded-lg group-hover:rotate-12 transition-transform duration-300">
              <Play className="fill-black w-6 h-6 text-black" />
            </div>
            <span className="text-2xl font-bold tracking-tighter text-white">SHEA <span className="text-primary text-gold-500">CINEMA</span></span>
          </Link>

          <div className="hidden md:flex items-center gap-6 text-sm font-medium text-white/70">
            <Link to="/" className="hover:text-primary transition-colors">سەرەتا</Link>
            {isAdmin && <Link to="/admin" className="text-primary font-bold hover:scale-105 transition-transform">بەڕێوبەرایەتی</Link>}
            <Link to="/movies" className="hover:text-primary transition-colors">فیلمەکان</Link>
            <Link to="/series" className="hover:text-primary transition-colors">زنجیرەکان</Link>
            <Link to="/kurdish" className="hover:text-primary transition-colors">بەرهەمی کوردی</Link>
            <button onClick={onOpenRequest} className="hover:text-primary transition-colors flex items-center gap-1.5">
              <HelpCircle className="w-4 h-4" /> داواکردنی فیلم
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger className="p-2 hover:bg-white/10 rounded-full transition-colors relative outline-none">
                <Bell className="w-5 h-5" />
                {notifications.some(n => !n.read) && (
                  <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-primary rounded-full border-2 border-[#0a0a0a]" />
                )}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-[#1a1a1a] border-white/10 text-white w-80 max-h-[400px] overflow-y-auto">
                <div className="p-4 border-b border-white/10 flex justify-between items-center">
                  <h3 className="font-bold">ئاگادارییەکان</h3>
                </div>
                {notifications.length > 0 ? (
                  notifications.map((n) => (
                    <DropdownMenuItem 
                      key={n.id} 
                      className={cn("p-4 border-b border-white/5 cursor-pointer flex flex-col items-start gap-1", !n.read && "bg-primary/5")}
                    >
                      <div className="flex justify-between w-full">
                        <span className="font-bold text-sm">{n.title}</span>
                        {!n.read && <div className="w-2 h-2 bg-primary rounded-full" />}
                      </div>
                      <p className="text-xs text-white/60">{n.message}</p>
                    </DropdownMenuItem>
                  ))
                ) : (
                  <div className="p-8 text-center text-white/40 text-sm">هیچ ئاگادارییەک نییە</div>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Link to="/search" className="p-2 hover:bg-white/10 rounded-full transition-colors">
            <Search className="w-5 h-5" />
          </Link>
          
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger className="cursor-pointer flex items-center gap-2 border border-white/10 pl-4 py-1 pr-1 rounded-full hover:bg-white/5 transition-colors outline-none">
                <img src={user.photoURL || undefined} alt={user.displayName || undefined} className="w-8 h-8 rounded-full border border-white/20" />
                <span className="text-xs hidden lg:block">{user.displayName}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-[#1a1a1a] border-white/10 text-white w-48">
                {isAdmin && (
                  <DropdownMenuItem className="focus:bg-white/10 cursor-pointer py-3">
                    <Link to="/admin" className="flex items-center gap-2 text-primary font-bold">
                      <Settings className="w-4 h-4" /> بەڕێوبەرایەتی
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem className="focus:bg-white/10 cursor-pointer py-3">
                   <Link to="/account" className="flex items-center gap-2">
                    <UserIcon className="w-4 h-4" /> هەژمارەکەم
                   </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onLogout} className="focus:bg-destructive/20 text-destructive cursor-pointer py-3 flex items-center gap-2">
                  <LogOut className="w-4 h-4" /> چوونەدەرەوە
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button onClick={onLogin} variant="outline" className="rounded-full px-6 border-white/20 hover:bg-white hover:text-black transition-all">
              چوونەژوورەوە
            </Button>
          )}

          <button className="md:hidden p-2" onClick={() => setMobileMenuOpen(true)}>
            <Menu className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div 
            initial={{ opacity: 0, x: 300 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 300 }}
            className="fixed inset-0 z-[60] bg-[#0a0a0a] flex flex-col p-8"
          >
            <div className="flex justify-between items-center mb-12">
              <span className="text-2xl font-bold tracking-tighter">SHEA <span className="text-primary">CINEMA</span></span>
              <button onClick={() => setMobileMenuOpen(false)}><X className="w-8 h-8" /></button>
            </div>
            <div className="flex flex-col gap-6 text-xl">
              <Link to="/" onClick={() => setMobileMenuOpen(false)}>سەرەتا</Link>
              {isAdmin && <Link to="/admin" onClick={() => setMobileMenuOpen(false)} className="text-primary font-bold">بەڕێوبەرایەتی</Link>}
              <Link to="/movies" onClick={() => setMobileMenuOpen(false)}>فیلمەکان</Link>
              <Link to="/series" onClick={() => setMobileMenuOpen(false)}>زنجیرەکان</Link>
              <Link to="/kurdish" onClick={() => setMobileMenuOpen(false)}>کوردینیمان</Link>
              <hr className="border-white/10" />
              {!user && <Button onClick={() => { onLogin(); setMobileMenuOpen(false); }}>چوونەژوورەوە</Button>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

function HomePage({ movies, favorites, watchHistory, toggleFavorite, isAdmin, setStatus }: { movies: Movie[]; favorites: string[]; watchHistory: WatchHistoryItem[]; toggleFavorite: (id: string) => void; isAdmin: boolean; setStatus: (s: { type: "success" | "error" | null; message: string }) => void }) {
  const featuredMovies = movies.filter(m => m.isFeatured === true);
  const slides = featuredMovies.length > 0 ? featuredMovies : movies.slice(0, 3);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);

  // Auto-cycle slider
  useEffect(() => {
    if (slides.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentSlideIndex((prev) => (prev + 1) % slides.length);
    }, 8000); // cycle every 8 seconds
    return () => clearInterval(interval);
  }, [slides.length]);

  const activeIndex = currentSlideIndex < slides.length ? currentSlideIndex : 0;
  const featured = slides[activeIndex];

  const [isSeeding, setIsSeeding] = useState(false);
  
  // Continue Watching
  const historyMovies = watchHistory
    .map(h => ({ ...movies.find(m => m.id === h.movieId), progress: h.progress }))
    .filter(m => m.id) as (Movie & { progress?: number })[];
 
  // Recommendations: Based on genres of favorites or history
  const userGenres = Array.from(new Set(
    movies.filter(m => favorites.includes(m.id)).map(m => m.category)
  ));
  const recommended = movies
    .filter(m => !favorites.includes(m.id) && userGenres.includes(m.category))
    .slice(0, 8);

  const handleSeedMovies = async () => {
    setIsSeeding(true);
    setStatus({ type: "success", message: "دەستکرا بە بارکردنی فیلمە نموونەییەکان..." });
    
    const sampleMovies = [
      {
        titleKu: "سوارچاکی تاریکی",
        titleEn: "The Dark Knight",
        category: "Action",
        year: 2008,
        duration: "2کژ 32خ",
        rating: 9.0,
        description: "کاتێک جۆکەر ئaژاوە لە گۆتهام دروست دەکات، باتمان تاقیکردنەوەیەکی قورسی مۆڕاڵی و جەستەیی دەکات بۆ پاراستنی شارەکەی.",
        posterUrl: "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=500&auto=format&fit=crop",
        bannerUrl: "https://images.unsplash.com/photo-1478760329108-5c3ed9d495a0?w=1600&auto=format&fit=crop",
        trailerUrl: "https://www.youtube.com/watch?v=EXeTwQWrcwY",
        qualities: [
          { label: "1080p FHD", url: "https://www.w3schools.com/html/mov_bbb.mp4" },
          { label: "720p HD", url: "https://www.w3schools.com/html/mov_bbb.mp4" }
        ],
        cast: [
          { name: "Christian Bale", role: "Bruce Wayne / Batman", imageUrl: "" },
          { name: "Heath Ledger", role: "Joker", imageUrl: "" }
        ],
        createdAt: new Date().toISOString()
      },
      {
        titleKu: "نێوان ئەستێرەکان",
        titleEn: "Interstellar",
        category: "Drama",
        year: 2014,
        duration: "2کژ 49خ",
        rating: 8.7,
        description: "گەشتێکی مێژوویی و زانستی سەرنجڕاکێش بەناو کونێکی کرمیدا بۆ گەڕان بەدوای نیشتمانێکی نوێ بۆ مرۆڤایەتی لەناو ئەستێرەکاندا.",
        posterUrl: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=500&auto=format&fit=crop",
        bannerUrl: "https://images.unsplash.com/photo-1444703686981-a3abbc4d4fe3?w=1600&auto=format&fit=crop",
        trailerUrl: "https://www.youtube.com/watch?v=zSWdZAZE3Tc",
        qualities: [
          { label: "1080p FHD", url: "https://www.w3schools.com/html/mov_bbb.mp4" },
          { label: "720p HD", url: "https://www.w3schools.com/html/mov_bbb.mp4" }
        ],
        cast: [
          { name: "Matthew McConaughey", role: "Cooper", imageUrl: "" },
          { name: "Anne Hathaway", role: "Brand", imageUrl: "" }
        ],
        createdAt: new Date().toISOString()
      },
      {
        titleKu: "هەنگوینی تاڵ",
        titleEn: "Bitter Honey",
        category: "Kurdish",
        year: 2021,
        duration: "1کژ 45خ",
        rating: 8.5,
        description: "درامایەکی کۆمەڵایەتی و پڕ لە ململانێ لە یەکێک لە گوندەکانی کوردستان کە باس لە خۆشەویستی و کێشە کۆمەڵایەتییەکان دەکات.",
        posterUrl: "https://images.unsplash.com/photo-1518173946687-a4c8a383392e?w=500&auto=format&fit=crop",
        bannerUrl: "https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=1600&auto=format&fit=crop",
        trailerUrl: "https://www.youtube.com/watch?v=EXeTwQWrcwY",
        qualities: [
          { label: "1080p FHD", url: "https://www.w3schools.com/html/mov_bbb.mp4" }
        ],
        cast: [
          { name: "کوردستان ئەحمەد", role: "ئەکتەر", imageUrl: "" }
        ],
        createdAt: new Date().toISOString()
      }
    ];

    try {
      for (const movie of sampleMovies) {
        await addDoc(collection(db, "movies"), movie);
      }
      setStatus({ type: "success", message: "سەرجەم فیلمە نموونەییەکان بە سەرکەوتوویی بارکران! لاپەڕەکە نوێ ببۆوە." });
    } catch (error: any) {
      console.error("Failed to seed database:", error);
      setStatus({ type: "error", message: `هەڵەیەک ڕوویدا لە بارکردنی داتا: ${error.message}` });
    } finally {
      setIsSeeding(false);
    }
  };
 
  if (!featured) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center text-white/40 gap-6 p-8 text-center max-w-xl mx-auto">
        <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center animate-pulse">
          <Play className="w-10 h-10 text-primary" />
        </div>
        <div className="space-y-3">
          <h2 className="text-3xl font-bold text-white">هیچ فیلمێک بەردەست نییە لەم کاتەدا</h2>
          <p className="text-white/60 text-sm leading-relaxed">
            بەخێربێن بۆ <span className="text-primary font-semibold">شیا سینەما</span>! بەهۆی ئەوەی داتابەیسەکە تازە و پاکە، هیچ فیلمێک لە ناو کۆکراوەی فیلمەکاندا (<span className="font-mono text-white/80">movies</span>) نییە.
          </p>
        </div>

        {isAdmin ? (
          <div className="bg-white/5 border border-white/10 rounded-3xl p-6 w-full space-y-4">
            <p className="text-xs text-white/50 leading-relaxed">
              تۆ وەک بەڕێوەبەر (ئەدمین) داخڵ بوویت! تکایە بچۆ بەشی بەڕێوەبەرایەتی بۆ زیادکردنی فیلمەکانت.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link 
                to="/admin" 
                className={cn(buttonVariants({ variant: "default" }), "bg-primary hover:bg-primary/80 text-black h-12 px-8 rounded-xl font-bold flex items-center justify-center gap-2")}
              >
                <Plus className="w-5 h-5" /> زیادکردنی فیلمەکان
              </Link>
            </div>
          </div>
        ) : (
          <div className="bg-white/5 border border-white/10 rounded-3xl p-6 w-full space-y-3 text-xs leading-relaxed text-white/50">
            <p>
              ئەگەر خاوەنی ماڵپەڕەکەی، تکایە بچۆ ژوورەوە بە هەژماری ئەدمین بۆ ئەوەی کۆنتڕۆڵەکە ببینیت و فیلمەکان دابنێیت.
            </p>
            <p className="font-semibold text-primary/80">
              ئیمەیڵی خاوەن: abubakrsleman4@gmail.com
            </p>
          </div>
        )}
      </div>
    );
  }
 
  const alignment = featured.bannerAlignment || "right";
  
  const containerAlignmentClass = cn(
    "relative z-10 max-w-7xl mx-auto px-4 md:px-8 w-full pb-20 flex",
    alignment === "center" ? "justify-center" : 
    alignment === "left" ? "justify-start text-left" : "justify-end text-right text-start"
  );

  const wrapperAlignmentClass = cn(
    "max-w-2xl space-y-6 flex flex-col w-full",
    alignment === "center" ? "items-center text-center mx-auto" : 
    alignment === "left" ? "items-start text-left mr-auto ml-0" : "items-start text-right ml-auto mr-0"
  );

  return (
    <div className="space-y-12 pb-24">
      <section className="relative h-[85vh] w-full flex items-end overflow-hidden">
        {/* Background Images with Crossfade */}
        <AnimatePresence mode="wait">
          <motion.div 
            key={`slide-bg-${featured.id}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7 }}
            className="absolute inset-0 z-0"
          >
            <img 
              src={featured.bannerUrl || featured.posterUrl || undefined} 
              alt={featured.titleKu || undefined} 
              className="w-full h-full object-cover" 
              referrerPolicy="no-referrer"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-transparent to-transparent z-10" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#0a0a0a]/60 via-transparent to-transparent z-10" />
            <div className="absolute inset-0 bg-gradient-to-l from-[#0a0a0a]/40 via-transparent to-transparent z-10" />
          </motion.div>
        </AnimatePresence>
 
        {/* Dynamic Content Details with Fade and Slide Transition */}
        <div className={containerAlignmentClass}>
          <AnimatePresence mode="wait">
            <motion.div
              key={`slide-content-${featured.id}`}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -30 }}
              transition={{ duration: 0.5 }}
              className={wrapperAlignmentClass}
            >
              <div className={cn("flex items-center gap-3", alignment === "center" ? "justify-center" : "justify-start")}>
                <Badge className="bg-primary text-black font-bold">فیلمی نایاب</Badge>
                <span className="text-white/60">{featured.year} • {featured.category} • {featured.rating} ★</span>
              </div>
              
              <h1 className={cn("text-5xl md:text-7xl font-bold tracking-tight", alignment === "center" ? "text-center" : alignment === "left" ? "text-left" : "text-right")}>{featured.titleKu}</h1>
              <p className={cn("text-white/70 text-lg leading-relaxed line-clamp-3", alignment === "center" ? "text-center max-w-xl" : alignment === "left" ? "text-left" : "text-right")}>{featured.description}</p>
              
              <div className={cn("flex flex-wrap gap-4 pt-4", alignment === "center" ? "justify-center" : "justify-start")}>
                <Link to={`/movie/${featured.id}`} className={cn(buttonVariants({ size: "lg" }), "rounded-full px-8 bg-primary hover:bg-primary/80 text-black font-bold h-14 text-lg flex items-center justify-center")}>
                  <Play className="ml-2 w-5 h-5 fill-current" /> ئێستا ببینە
                </Link>
                <Link to={`/movie/${featured.id}`} className={cn(buttonVariants({ size: "lg", variant: "outline" }), "rounded-full px-8 bg-white/5 border-white/20 hover:bg-white/10 h-14 text-lg text-white flex items-center justify-center")}>
                  زانیاری زیاتر
                </Link>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Arrow controllers and Pagination dots for multiple slides */}
        {slides.length > 1 && (
          <>
            <button
              onClick={() => setCurrentSlideIndex((prev) => (prev - 1 + slides.length) % slides.length)}
              className="absolute right-4 top-1/2 -translate-y-1/2 z-20 p-2.5 rounded-full bg-black/40 text-white/70 hover:text-white hover:bg-black/70 border border-white/15 hover:scale-105 transition-all hidden md:flex items-center justify-center"
              aria-label="Previous slide"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
            <button
              onClick={() => setCurrentSlideIndex((prev) => (prev + 1) % slides.length)}
              className="absolute left-4 top-1/2 -translate-y-1/2 z-20 p-2.5 rounded-full bg-black/40 text-white/70 hover:text-white hover:bg-black/70 border border-white/15 hover:scale-105 transition-all hidden md:flex items-center justify-center"
              aria-label="Next slide"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>

            {/* Pagination custom indicator dots */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 z-20">
              {slides.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setCurrentSlideIndex(idx)}
                  className={cn(
                    "h-2 rounded-full transition-all duration-300",
                    idx === activeIndex ? "w-8 bg-primary" : "w-2 bg-white/30 hover:bg-white/50"
                  )}
                  aria-label={`Go to slide ${idx + 1}`}
                />
              ))}
            </div>
          </>
        )}
      </section>
 
      <div className="max-w-7xl mx-auto px-4 md:px-8 space-y-16">
        {historyMovies.length > 0 && (
          <MovieSlider title="بەردەوامی پێ بدە" movies={historyMovies} favorites={favorites} toggleFavorite={toggleFavorite} />
        )}
        
        {recommended.length > 0 && (
          <MovieSlider title="پێشنیارکراو بۆ تۆ" movies={recommended} favorites={favorites} toggleFavorite={toggleFavorite} />
        )}
 
        <MovieSlider title="نوێترین فیلمە کوردیەکان" movies={movies.filter(m => m.category === "Kurdish")} favorites={favorites} toggleFavorite={toggleFavorite} />
        <MovieSlider title="فیلمە پڕ بینەرەکان" movies={movies} favorites={favorites} toggleFavorite={toggleFavorite} />
        <MovieSlider title="دراماکان" movies={movies.filter(m => m.category === "Drama")} favorites={favorites} toggleFavorite={toggleFavorite} />
      </div>
    </div>
  );
}

function MovieSlider({ title, movies, favorites, toggleFavorite }: { title: string; movies: Movie[]; favorites: string[]; toggleFavorite: (id: string) => void }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          {title}
          <div className="w-1.5 h-1.5 bg-primary rounded-full mt-1" />
        </h2>
        <Button variant="link" className="text-white/40 hover:text-primary p-0">بینینی هەمووی <ChevronRight className="mr-1 w-4 h-4" /></Button>
      </div>
      
      <div className="flex gap-4 overflow-x-auto pb-6 scrollbar-hide no-scrollbar">
        {movies.map((movie) => (
          <MovieCard 
            key={movie.id} 
            movie={movie} 
            isFavorite={favorites.includes(movie.id)} 
            onToggleFavorite={() => toggleFavorite(movie.id)}
            progress={(movie as any).progress} 
          />
        ))}
      </div>
    </div>
  );
}

function MovieCard({ movie, isFavorite, onToggleFavorite, progress }: { movie: Movie; isFavorite: boolean; onToggleFavorite: () => void; progress?: number; key?: string }) {
  return (
    <div className="min-w-[180px] md:min-w-[220px] group relative">
      <Link to={`/movie/${movie.id}`}>
        <div className="relative aspect-[2/3] rounded-2xl overflow-hidden mb-3 border border-white/5 transition-all duration-300 group-hover:scale-[1.02] group-hover:shadow-[0_0_30px_rgba(255,183,0,0.2)]">
          <img 
            src={movie.posterUrl || undefined} 
            alt={movie.titleKu || undefined} 
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" 
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/60 transition-all duration-300 flex items-center justify-center opacity-0 group-hover:opacity-100">
            <div className="w-12 h-12 bg-primary rounded-full flex items-center justify-center translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
              <Play className="fill-black text-black w-6 h-6 ml-0.5" />
            </div>
          </div>
          <div className="absolute top-2 left-2 flex flex-col gap-1 items-start">
             <Badge className="bg-black/80 backdrop-blur-md text-[10px] md:text-xs border-white/10">{movie.rating} ★</Badge>
             {movie.contentType === "series" ? (
               <Badge className="bg-amber-500 text-black font-extrabold text-[9px] md:text-[10px] border-none shadow-md">زنجیرە</Badge>
             ) : (
               <Badge className="bg-black/70 backdrop-blur-sm text-white font-medium text-[9px] md:text-[10px] border-white/5 shadow-sm">فیلم</Badge>
             )}
          </div>
          <div className="absolute bottom-2 right-2 flex flex-col gap-1">
             <Badge className="bg-primary/90 text-black font-bold text-[10px] md:text-xs">HD</Badge>
          </div>
          
          {progress !== undefined && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
              <div 
                className="h-full bg-primary" 
                style={{ width: `${progress}%` }} 
              />
            </div>
          )}
        </div>
      </Link>
      
      {/* Favorite Button */}
      <button 
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleFavorite();
        }}
        className={`absolute top-2 right-2 z-20 p-2 rounded-full backdrop-blur-md transition-all duration-300 ${isFavorite ? "bg-primary text-black" : "bg-black/40 text-white hover:bg-white/20"}`}
      >
        <Heart className={`w-4 h-4 ${isFavorite ? "fill-current" : ""}`} />
      </button>

      <div className="space-y-1">
        <h3 className="font-bold text-sm md:text-base line-clamp-1 group-hover:text-primary transition-colors">{movie.titleKu}</h3>
        <p className="text-white/40 text-xs md:text-sm">{movie.year} • {movie.category}</p>
      </div>
    </div>
  );
}

function MoviePage({ movies, user, favorites, toggleFavorite, setStatus, addToHistory, addReview, isAdmin, showConfirm }: { movies: Movie[]; user: User | null; favorites: string[]; toggleFavorite: (id: string) => void; setStatus: (s: { type: "success" | "error" | null; message: string }) => void; addToHistory: (id: string) => void; addReview: (movieId: string, rating: number, comment: string) => void; isAdmin?: boolean; showConfirm: (title: string, message: string, onConfirm: () => void, onCancel?: () => void) => void }) {
  const navigate = useNavigate();
  const { id } = useParams();
  const movie = movies.find(m => m.id === id);
  const [activeSeasonId, setActiveSeasonId] = useState<string>("");
  const [activeEpisodeId, setActiveEpisodeId] = useState<string>("");

  const currentSeason = movie?.seasons?.find(s => s.id === activeSeasonId) || movie?.seasons?.[0] || null;
  const currentEpisode = currentSeason?.episodes?.find(e => e.id === activeEpisodeId) || currentSeason?.episodes?.[0] || null;

  const [selectedQuality, setSelectedQuality] = useState(movie?.qualities[0] || null);
  const [selectedSubtitle, setSelectedSubtitle] = useState<any>(null);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewRating, setReviewRating] = useState(10);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleSelectEpisode = (season: any, episode: any) => {
    setActiveSeasonId(season.id);
    setActiveEpisodeId(episode.id);
    if (episode.qualities && episode.qualities.length > 0) {
      setSelectedQuality(episode.qualities[0]);
    } else {
      setSelectedQuality(null);
    }
  };

  const handleUpdateMovie = async (updatedData: Partial<Movie>) => {
    if (!movie) return;
    setIsSaving(true);
    try {
      const movieRef = doc(db, "movies", movie.id);
      await updateDoc(movieRef, updatedData);

      setStatus({ type: "success", message: "زانیارییەکانی فیلمەکە بە سەرکەوتوویی نوێکرایەوە" });
      setIsEditing(false);
    } catch (error: any) {
      console.error("Error updating movie:", error);
      setStatus({ type: "error", message: `هەڵەیەک ڕوویدا لە نوێکردنەوەی فیلم: ${error.message}` });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteMovie = async () => {
    if (!movie) return;
    showConfirm(
      "سڕینەوەی فیلمەکە",
      `ئایا دڵنیایت لە سڕینەوەی فیلمی "${movie.titleKu || ''}"؟ ئەم کردارە ناتوانرێت پاشگەز بکرێتەوە.`,
      async () => {
        try {
          await deleteDoc(doc(db, "movies", movie.id));
          setStatus({ type: "success", message: "فیلمەکە بە سەرکەوتوویی سڕایەوە" });
          navigate("/");
        } catch (error: any) {
          console.error("Error deleting movie:", error);
          setStatus({ type: "error", message: `هەڵەیەک ڕوویدا لە سڕینەوەی فیلم: ${error.message}` });
        }
      }
    );
  };

  const handleDeleteReview = async (reviewId: string) => {
    if (!movie) return;
    showConfirm(
      "سڕینەوەی کۆمێنت",
      "ئایا دڵنیایت لە سڕینەوەی ئەم کۆمێنتە؟",
      async () => {
        try {
          await deleteDoc(doc(db, "movies", movie.id, "reviews", reviewId));
          setStatus({ type: "success", message: "کۆمێنتەکە سڕایەوە." });
        } catch (error) {
          setStatus({ type: "error", message: "کێشەیەک ڕوویدا لە سڕینەوەی کۆمێنت." });
        }
      }
    );
  };

  useEffect(() => {
    if (!id) return;
    const reviewsRef = collection(db, "movies", id, "reviews");
    const q = query(reviewsRef, orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedReviews = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate()?.toISOString() || new Date().toISOString()
      })) as Review[];
      setReviews(fetchedReviews);
    });
    return () => unsubscribe();
  }, [id]);
  
  // Sync selected quality when movie loads or changes
  useEffect(() => {
    if (movie) {
      if (movie.contentType === "series" && movie.seasons && movie.seasons.length > 0) {
        const firstSeason = movie.seasons[0];
        setActiveSeasonId(firstSeason.id);
        if (firstSeason.episodes && firstSeason.episodes.length > 0) {
          const firstEpisode = firstSeason.episodes[0];
          setActiveEpisodeId(firstEpisode.id);
          if (firstEpisode.qualities && firstEpisode.qualities.length > 0) {
            setSelectedQuality(firstEpisode.qualities[0]);
          } else {
            setSelectedQuality(null);
          }
        } else {
          setActiveEpisodeId("");
          setSelectedQuality(null);
        }
      } else if (movie.qualities && movie.qualities.length > 0) {
        setSelectedQuality(movie.qualities[0]);
      } else {
        setSelectedQuality(null);
      }
    }
  }, [movie?.id]); 

  const isFavorite = movie ? favorites.includes(movie.id) : false;
  const [showTrailer, setShowTrailer] = useState(false);

  const getEmbedUrl = (url: string) => {
    if (url.includes("youtube.com/watch?v=")) {
      return url.replace("watch?v=", "embed/");
    }
    if (url.includes("youtu.be/")) {
      const parts = url.split("/");
      const lastPart = parts[parts.length - 1];
      return `https://www.youtube.com/embed/${lastPart}`;
    }
    return url;
  };

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);

  if (!movie) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#0a0a0a] text-white/40 gap-4">
        <div className="p-20 text-center animate-pulse">لە بارکردنی فیلمەکەداین...</div>
      </div>
    );
  }

  if (isEditing) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="bg-[#111] p-8 rounded-3xl border border-primary/30 space-y-8 animate-in fade-in duration-300">
          <div className="flex justify-between items-center pb-4 border-b border-white/5">
            <h2 className="text-2xl font-bold text-primary flex items-center gap-2">
              <Edit2 className="w-6 h-6" /> دەستکاریکردنی فیلم
            </h2>
            <Button variant="ghost" className="text-white/40 hover:text-white" onClick={() => setIsEditing(false)}>پاشگەزبوونەوە</Button>
          </div>
          <MovieForm 
            initialData={movie || {}} 
            onSave={handleUpdateMovie} 
            onCancel={() => setIsEditing(false)} 
            isSaving={isSaving} 
          />
        </div>
      </div>
    );
  }

  return (
    <div className="pb-24">
      {/* Back Button */}
      <div className="max-w-7xl mx-auto px-4 md:px-8 mt-4 mb-4">
        <Button 
          variant="ghost" 
          onClick={() => navigate(-1)} 
          className="text-white/60 hover:text-white gap-2"
        >
          <Menu className="w-4 h-4 rotate-180" /> گەڕانەوە
        </Button>
      </div>
      <div className="bg-black w-full aspect-video md:h-[70vh] relative group overflow-hidden">
        {selectedQuality?.url ? (
           <div className="w-full h-full relative group">
              {(() => {
                const rawUrl = selectedQuality.url;
                let url = rawUrl.trim();
                if (url.startsWith("<iframe") || url.includes("src=")) {
                  const match = url.match(/src=["']([^"']+)["']/i);
                  if (match && match[1]) {
                    url = match[1];
                    if (url.startsWith("//")) {
                      url = "https:" + url;
                    }
                  }
                }
                
                // Auto-convert streamtape watch URLs (/v/) to embed URLs (/e/)
                if (url.includes("streamtape") || url.includes("streamta.pe") || url.includes("shavetape")) {
                  url = url.replace(/\/v\//, "/e/");
                }
                
                // Auto-convert doodstream watch URLs (/d/) to embed URLs (/e/)
                if (url.includes("dood") && url.includes("/d/")) {
                  url = url.replace(/\/d\//, "/e/");
                }

                const lowUrl = url.toLowerCase();
                // Enhanced detection for direct video files or streams
                const isDirectFile = 
                  lowUrl.endsWith(".mp4") || 
                  lowUrl.endsWith(".m3u8") || 
                  lowUrl.endsWith(".mkv") || 
                  lowUrl.endsWith(".webm") ||
                  lowUrl.includes("/video/") ||
                  lowUrl.includes(".m3u8?") ||
                  lowUrl.includes("m3u8") ||
                  lowUrl.includes("stream");
                
                const Player = ReactPlayer as any;

                if (isDirectFile) {
                  return (
                    <div className="w-full h-full bg-black">
                      <Player 
                        key={url}
                        url={url}
                        width="100%"
                        height="100%"
                        controls
                        playing={false} // Disable autoplay to avoid browser blocks/hangs
                        pip={false}
                        stopOnTerminate={true}
                        onPlay={() => addToHistory(movie.id)}
                        onError={(e: any) => setStatus({ type: "error", message: "سێرڤەرەکە کێشەی تێدایە یان لینکەکە ئیش ناکات" })}
                        config={{
                          file: {
                            attributes: {
                              poster: movie.bannerUrl || undefined,
                              controlsList: 'nodownload',
                              disablePictureInPicture: true,
                              onContextMenu: (e: any) => e.preventDefault(),
                              crossOrigin: 'anonymous'
                            },
                            tracks: (movie.contentType === "series" ? (currentEpisode?.subtitles || []) : (movie.subtitles || [])).map(s => ({
                              kind: 'subtitles',
                              src: s.url,
                              srcLang: s.lang,
                              label: s.label,
                              default: s.lang === 'ku'
                            })) || []
                          }
                        }}
                      />
                    </div>
                  );
                } else {
                  // Fallback to iframe for other types of links (embeds, etc)
                  return (
                    <div className="w-full h-full bg-black">
                      <iframe 
                        src={url} 
                        className="w-full h-full border-0" 
                        allowFullScreen
                        allow="autoplay; encrypted-media; picture-in-picture"
                        title="Video Player"
                      />
                    </div>
                  );
                }
              })()}
              
              <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                 {movie.contentType === "series" && currentEpisode && (
                   <div className="bg-primary text-black font-bold px-3 py-1.5 rounded-full text-[10px] shadow-md">
                     {currentSeason?.titleKu || `وەرزی ${currentSeason?.seasonNumber}`} - {currentEpisode?.titleKu || `ئەڵقەی ${currentEpisode?.episodeNumber}`}
                   </div>
                 )}
                 <div className="bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 text-[10px] text-white/60">
                   {selectedQuality.label}
                 </div>
              </div>
           </div>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-6 bg-[#1a1a1a]">
            {user ? (
               <>
                 <Play className="w-20 h-20 text-white/20" />
                 <p className="text-white/60">لینکەکان ئامادە دەکرێن...</p>
               </>
            ) : (
              <div className="text-center p-8 max-w-md space-y-4">
                <h3 className="text-2xl font-bold">بۆ بینینی ئەم فیلمە پێویستە بچیتە ژوورەوە</h3>
                <p className="text-white/40">ببە بە ئەندام و چێژ لە هەموو فیلم و زنجیرەکان وەربگرە</p>
                <Button onClick={() => navigate("/account")} className="bg-primary text-black font-bold rounded-full px-8">چوونەژوورەوە</Button>
              </div>
            )}
          </div>
        )}

        {/* Quality Selector Overlay (simplified UI) */}
        {user && (movie.contentType === "series" ? (currentEpisode?.qualities?.length || 0) > 0 : (movie.qualities?.length || 0) > 0) && (
          <div className="absolute bottom-16 left-8 z-20">
            <DropdownMenu>
              <DropdownMenuTrigger className={cn(buttonVariants({ variant: "outline", size: "sm" }), "bg-black/60 border-white/10 backdrop-blur-md rounded-full text-xs text-white")}>
                کوالێتی: {selectedQuality?.label}
              </DropdownMenuTrigger>
              <DropdownMenuContent className="bg-black/90 border-white/10 text-white min-w-[100px]">
                {(movie.contentType === "series" ? (currentEpisode?.qualities || []) : movie.qualities).map((q) => (
                  <DropdownMenuItem key={q.label} onClick={() => setSelectedQuality(q)} className="focus:bg-primary/20 text-xs">
                    {q.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-8 mt-12 grid grid-cols-1 lg:grid-cols-3 gap-12">
        <div className="lg:col-span-2 space-y-8">
          <div className="flex flex-wrap items-center gap-4">
            <h1 className="text-4xl font-bold">{movie.titleKu}</h1>
            <Badge className="bg-white/10 text-white/60 border-white/10">{movie.year}</Badge>
            <Badge className="bg-primary/20 text-primary border-primary/20">{movie.category}</Badge>
            <Button 
              onClick={() => toggleFavorite(movie.id)}
              variant="outline" 
              className={`rounded-full gap-2 border-white/10 transition-all ${isFavorite ? "bg-primary text-black hover:bg-primary/80" : "bg-white/5 hover:bg-white/10"}`}
            >
              <Heart className={`w-4 h-4 ${isFavorite ? "fill-current" : ""}`} />
              {isFavorite ? "لادان لە لیست" : "زیادکردن بۆ لیست"}
            </Button>

            {isAdmin && (
              <div className="flex flex-wrap items-center gap-2">
                <Button 
                  onClick={async () => {
                    try {
                      const movieRef = doc(db, "movies", movie.id);
                      const newStatus = !movie.isFeatured;
                      await updateDoc(movieRef, { isFeatured: newStatus });
                      if (newStatus) {
                        setStatus({ type: "success", message: "فیلمەکە نیشان دەدرێت لە بەشی سەرەکی سەرەوە" });
                      } else {
                        setStatus({ type: "success", message: "فیلمەکە لە بەشی سەرەکی سەرەوە لادرا" });
                      }
                    } catch (err: any) {
                      console.error("Error toggling featured: ", err);
                      setStatus({ type: "error", message: `کێشەیەک ڕوویدا: ${err.message}` });
                    }
                  }}
                  variant="outline" 
                  className={`rounded-full gap-2 border-yellow-500/30 hover:bg-yellow-500/10 ${movie.isFeatured ? "bg-yellow-500/20 text-yellow-500 border-yellow-500/50" : "bg-yellow-500/5 text-yellow-500/80"}`}
                >
                  <Star className={`w-4 h-4 ${movie.isFeatured ? "fill-current text-yellow-500" : ""}`} />
                  {movie.isFeatured ? "لادان لە سەرەکی" : "دانان وەک فیلمی سەرەکی"}
                </Button>

                <Button 
                  onClick={() => setIsEditing(true)}
                  variant="outline" 
                  className="rounded-full gap-2 border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary"
                >
                  <Edit2 className="w-4 h-4" />
                  دەستکاریکردن
                </Button>
                <Button 
                  onClick={handleDeleteMovie}
                  variant="outline"
                  className="rounded-full gap-2 border-red-500/30 bg-red-500/10 text-red-500 hover:bg-red-500/20 hover:text-red-500"
                >
                  <Trash2 className="w-4 h-4" />
                  سڕینەوە
                </Button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-8 text-white/60">
            <div className="flex items-center gap-1 text-primary">
              <Star className="w-5 h-5 fill-current" />
              <span className="font-bold text-white">{movie.rating}</span>
            </div>
            <div className="flex items-center gap-1">
              <span>ماوە: </span>
              <span className="text-white">{movie.duration}</span>
            </div>
          </div>

          <p className="text-lg leading-relaxed text-white/70 bg-white/5 p-6 rounded-2xl border border-white/5">
            {movie.description}
          </p>

          {/* Seasons & Episodes Selector for Series */}
          {movie.contentType === "series" && movie.seasons && movie.seasons.length > 0 && (
            <div className="space-y-6 pt-4 bg-[#111] p-6 rounded-3xl border border-white/5">
              <div className="flex items-center justify-between border-b border-white/5 pb-4">
                <h3 className="text-2xl font-bold flex items-center gap-2 text-primary">
                  <Play className="w-6 h-6 fill-current text-primary animate-pulse" /> وەرز و ئەڵقەکان
                </h3>
                <span className="text-white/40 text-sm font-bold bg-white/5 px-3 py-1 rounded-full">{movie.seasons.length} وەرز</span>
              </div>

              {/* Seasons horizontal tab list */}
              <div className="flex gap-2.5 overflow-x-auto pb-3.5 no-scrollbar">
                {movie.seasons.map((season) => (
                  <button
                    key={season.id}
                    onClick={() => {
                      setActiveSeasonId(season.id);
                      if (season.episodes && season.episodes.length > 0) {
                        setActiveEpisodeId(season.episodes[0].id);
                        if (season.episodes[0].qualities && season.episodes[0].qualities.length > 0) {
                          setSelectedQuality(season.episodes[0].qualities[0]);
                        } else {
                          setSelectedQuality(null);
                        }
                      } else {
                        setActiveEpisodeId("");
                        setSelectedQuality(null);
                      }
                    }}
                    className={cn(
                      "px-5 py-2.5 rounded-xl font-bold text-sm whitespace-nowrap transition-all border",
                      activeSeasonId === season.id
                        ? "bg-primary text-black border-primary shadow-lg shadow-primary/20 scale-105"
                        : "bg-white/5 text-white/60 border-white/5 hover:bg-white/10 hover:text-white"
                    )}
                  >
                    {season.titleKu || `وەرزی ${season.seasonNumber}`}
                  </button>
                ))}
              </div>

              {/* Episodes List grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                {currentSeason?.episodes && currentSeason.episodes.length > 0 ? (
                  currentSeason.episodes.map((episode) => {
                    const isPlaying = activeEpisodeId === episode.id;
                    return (
                      <button
                        key={episode.id}
                        onClick={() => handleSelectEpisode(currentSeason, episode)}
                        className={cn(
                          "flex items-center justify-between p-4 rounded-2xl border text-right transition-all group/ep",
                          isPlaying
                            ? "bg-primary/10 border-primary text-white shadow-md shadow-primary/5"
                            : "bg-white/5 border-white/5 text-white/80 hover:bg-white/10"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all",
                            isPlaying ? "bg-primary text-black scale-105" : "bg-white/5 group-hover/ep:bg-primary group-hover/ep:text-black text-white"
                          )}>
                            <Play className="w-4 h-4 fill-current ml-0.5" />
                          </div>
                          <div>
                            <div className="font-bold text-sm line-clamp-1">
                              {episode.titleKu || `ئەڵقەی ${episode.episodeNumber}`}
                            </div>
                            {episode.titleEn && (
                              <div className="text-xs text-white/35 font-medium line-clamp-1">
                                {episode.titleEn}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {episode.duration && (
                            <span className="text-[10px] text-white/30 font-semibold bg-white/5 px-2 py-1 rounded-md">
                              {episode.duration}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="col-span-2 py-12 text-center text-white/20 italic">
                    هیچ ئەڵقەیەک بۆ ئەم وەرزە بەردەست نییە.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Cast Section */}
          {movie.cast && movie.cast.length > 0 && (
            <div className="space-y-6 pt-8">
              <h3 className="text-2xl font-bold border-r-4 border-primary pr-4">ئەکتەرەکان</h3>
              <div className="flex gap-6 overflow-x-auto pb-4 no-scrollbar">
                {movie.cast.map((person, idx) => (
                  <div key={idx} className="min-w-[120px] text-center space-y-3 group">
                    <div className="aspect-square rounded-full overflow-hidden border-2 border-white/5 group-hover:border-primary transition-colors">
                      <img 
                        src={person.imageUrl || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&h=200&fit=crop"} 
                        alt={person.name} 
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" 
                        referrerPolicy="no-referrer"
                      />
                    </div>
                    <div>
                      <div className="font-bold text-sm">{person.name}</div>
                      <div className="text-xs text-white/40">{person.role}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reviews Section */}
          <div className="space-y-8 pt-12 border-t border-white/5">
             <div className="flex items-center justify-between">
                <h3 className="text-2xl font-bold border-r-4 border-primary pr-4">ڕا و سەرنجەکان</h3>
                <Badge variant="outline" className="text-white/40">{reviews.length} کۆمێنت</Badge>
             </div>

             {user ? (
               <div className="bg-[#1a1a1a] p-6 rounded-2xl border border-white/10 space-y-4">
                  <div className="flex items-center gap-4">
                     <span className="text-sm font-bold">نمرەکەت:</span>
                     <div className="flex gap-2">
                        {[2, 4, 6, 8, 10].map(val => (
                          <button 
                            key={val}
                            onClick={() => setReviewRating(val)}
                            className={cn("w-8 h-8 rounded-full border border-white/10 text-xs transition-all", reviewRating === val ? "bg-primary text-black border-primary font-bold" : "hover:border-primary/40")}
                          >
                            {val}
                          </button>
                        ))}
                     </div>
                  </div>
                  <textarea 
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                    placeholder="ڕاکەت لێرە بنووسە..."
                    className="w-full bg-[#0a0a0a] border border-white/10 rounded-xl p-4 min-h-[100px] outline-none focus:border-primary transition-all text-white"
                  />
                  <div className="flex justify-end">
                    <Button 
                      disabled={!reviewComment.trim()}
                      onClick={() => {
                        addReview(movie.id, reviewRating, reviewComment);
                        setReviewComment("");
                      }}
                      className="bg-primary text-black font-bold h-12 px-8 rounded-xl"
                    >
                      بڵاوکردنەوەی ڕا
                    </Button>
                  </div>
               </div>
             ) : (
               <div className="p-8 text-center bg-white/5 rounded-2xl border border-dashed border-white/10 text-white/40">
                  بۆ نووسینی ڕاکەت، پێویستە سەرەتا بچیتە ژوورەوە
               </div>
             )}

             <div className="space-y-6">
                {reviews.length > 0 ? (
                  reviews.map((review) => (
                    <div key={review.id} className="flex gap-4 p-6 bg-white/5 rounded-2xl border border-white/5">
                       <div className="shrink-0">
                          <img 
                            src={review.userPhoto || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop"} 
                            alt={review.userName} 
                            className="w-12 h-12 rounded-full object-cover border-2 border-white/10" 
                            referrerPolicy="no-referrer"
                          />
                       </div>
                       <div className="space-y-2 flex-1">
                          <div className="flex justify-between items-start">
                             <div className="flex items-center gap-3">
                                <div className="font-bold">{review.userName}</div>
                                {isAdmin && (
                                  <button 
                                    onClick={() => handleDeleteReview(review.id)}
                                    className="text-white/30 hover:text-red-500 transition-colors p-1 rounded-md hover:bg-white/5"
                                    title="سڕینەوەی کۆمێنت"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                             </div>
                             <div className="flex items-center gap-1 text-primary text-sm font-bold">
                                <Star className="w-3 h-3 fill-current" /> {review.rating}
                             </div>
                          </div>
                          <p className="text-white/70 text-sm leading-relaxed">{review.comment}</p>
                          <div className="text-[10px] text-white/20 uppercase tracking-widest pt-2">
                             {new Date(review.createdAt).toLocaleDateString("ku-IQ")}
                          </div>
                       </div>
                    </div>
                  ))
                ) : (
                  <div className="py-12 text-center text-white/20 italic">هیچ ڕایەک بۆ ئەم فیلمە نییە، تۆ ببە بە یەکەم کەس!</div>
                )}
             </div>
          </div>

          <div className="space-y-4 pt-8">
            <h3 className="text-xl font-bold">فیلمی پەیوەندیدار</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {movies.filter(m => m.id !== movie.id).slice(0, 3).map(m => (
                <MovieCard key={m.id} movie={m} isFavorite={favorites.includes(m.id)} onToggleFavorite={() => toggleFavorite(m.id)} />
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-[#1a1a1a] p-6 rounded-2xl border border-white/10 space-y-6">
            <h3 className="text-lg font-bold border-b border-white/10 pb-4">سێرڤەرەکانی بینین</h3>
            <div className="grid gap-3">
              {(movie.contentType === "series" ? (currentEpisode?.qualities || []) : movie.qualities).map((q, idx) => {
                const isSelected = selectedQuality?.url === q.url;
                return (
                  <Button 
                    key={idx} 
                    onClick={() => setSelectedQuality(q)}
                    className={`w-full justify-between border border-white/10 rounded-xl py-6 transition-all ${isSelected ? "bg-primary text-black border-primary" : "bg-white/5 hover:bg-white/10 text-white"}`}
                    variant="outline"
                  >
                     <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isSelected ? "bg-black/20 text-black" : "bg-primary/20 text-primary"}`}>
                          {idx + 1}
                        </div>
                        <span>سێرڤەری {q.label}</span>
                     </div>
                     <Play className={`w-4 h-4 ${isSelected ? "fill-current" : ""}`} />
                  </Button>
                );
              })}
              {movie.contentType === "series" && (!currentEpisode || !currentEpisode.qualities || currentEpisode.qualities.length === 0) && (
                <p className="text-center py-4 text-xs text-white/40 italic">هیچ سێرڤەرێک بۆ ئەم ئەڵقەیە بەردەست نییە.</p>
              )}
            </div>
          </div>

          {movie.trailerUrl && (
            <div className="bg-primary/10 p-6 rounded-2xl border border-primary/20">
               <div className="flex items-center gap-4 mb-4">
                 <TrendingUp className="w-6 h-6 text-primary" />
                 <h3 className="font-bold text-primary">ترێیلەر ببینە</h3>
               </div>
               
               <div className="aspect-video bg-black rounded-lg relative overflow-hidden group">
                  {showTrailer ? (
                    <iframe 
                      src={getEmbedUrl(movie.trailerUrl) || undefined} 
                      className="w-full h-full" 
                      allowFullScreen 
                      allow="autoplay; encrypted-media"
                    />
                  ) : (
                    <div className="w-full h-full cursor-pointer relative" onClick={() => setShowTrailer(true)}>
                      <img src={movie.bannerUrl || undefined} className="w-full h-full object-cover opacity-60 group-hover:scale-105 transition-transform" referrerPolicy="no-referrer" />
                      <div className="absolute inset-0 flex items-center justify-center">
                         <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center">
                           <Play className="w-4 h-4 text-black fill-current ml-1" />
                         </div>
                      </div>
                    </div>
                  )}
               </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AccountPage({ user, movies, favorites, onLogin, onLogout, toggleFavorite }: { user: User | null; movies: Movie[]; favorites: string[]; onLogin: () => void; onLogout: () => void; toggleFavorite: (id: string) => void }) {
  if (!user) {
    return (
      <div className="max-w-xl mx-auto px-4 py-24 text-center space-y-12">
        <div className="space-y-4">
          <div className="w-20 h-20 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-8">
            <UserIcon className="w-10 h-10 text-primary" />
          </div>
          <h1 className="text-4xl font-bold">بەخێربێیت بۆ Shea Cinema</h1>
          <p className="text-white/60 text-lg">بۆ بینینی فیلم و دراماکان و هەڵگرتنی دڵخوازەکانت، پێویستە پێشتر داخڵ ببیت.</p>
        </div>
        
        <div className="grid gap-4">
          <Button onClick={onLogin} size="lg" className="h-16 rounded-full bg-white text-black font-bold text-lg hover:bg-white/90 gap-4 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-6 h-6"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            بەردەوامبە لە ڕێگەی گووگڵەوە
          </Button>

          <Button size="lg" disabled className="h-16 rounded-full bg-[#1a1a1a] text-white font-bold text-lg border border-white/10 gap-4 flex items-center justify-center opacity-70">
            <Apple className="w-6 h-6 fill-current" />
            بەردەوامبە لە ڕێگەی ئەپڵەوە (بەمنزیکانە)
          </Button>
        </div>
        
        <p className="text-xs text-white/40">بە چوونەژوورەوەت، هاوڕایت لەگەڵ مەرج و ڕێساکانی شیا سینەما.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-16 space-y-12">
      <div className="flex items-center gap-8 bg-[#1a1a1a] p-8 rounded-3xl border border-white/10">
        <img src={user.photoURL || undefined} alt={user.displayName || undefined} className="w-24 h-24 rounded-full border-4 border-primary" />
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">{user.displayName}</h1>
          <p className="text-white/60">{user.email}</p>
          <div className="flex gap-2">
             <Badge className="bg-primary text-black">ئەندامی ڤی ئای پی</Badge>
             <Badge variant="outline">کوردینیمان</Badge>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-[#1a1a1a] p-8 rounded-3xl border border-white/10 space-y-6">
           <h3 className="text-xl font-bold flex items-center gap-2 text-primary">
             <Star className="w-5 h-5 fill-current" /> لیستەکانم
           </h3>
           <div className="space-y-4">
             {favorites.length > 0 ? (
               <div className="grid grid-cols-2 gap-4">
                 {movies.filter(m => favorites.includes(m.id)).map(movie => (
                   <div key={movie.id} className="relative group">
                     <Link to={`/movie/${movie.id}`}>
                        <div className="aspect-[2/3] rounded-xl overflow-hidden mb-2 border border-white/5">
                           <img src={movie.posterUrl || undefined} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                        </div>
                        <p className="font-bold text-sm line-clamp-1">{movie.titleKu}</p>
                     </Link>
                     <Button 
                        size="icon" 
                        variant="destructive" 
                        className="absolute top-2 right-2 rounded-full w-8 h-8 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => toggleFavorite(movie.id)}
                     >
                        <X className="w-4 h-4" />
                     </Button>
                   </div>
                 ))}
               </div>
             ) : (
               <div className="flex flex-col gap-4 text-white/60">
                 <p>لیستی هیچ فیلمێکت نەکردووەتەوە</p>
                 <Link to="/" className="text-primary hover:underline">گەڕان بکە بۆ فیلمەکان</Link>
               </div>
             )}
           </div>
        </div>

        <div className="bg-[#1a1a1a] p-8 rounded-3xl border border-white/10 space-y-6">
           <h3 className="text-xl font-bold flex items-center gap-2">
             <Settings className="w-5 h-5 text-primary" /> ڕێکخستنەکان
           </h3>
           <div className="space-y-4">
             <Button variant="outline" className="w-full justify-start text-white/70 py-6 rounded-xl border-white/10 gap-2">گۆڕینی زمانی ئەپڵیکەیشن</Button>
             <Button onClick={onLogout} variant="destructive" className="w-full justify-start py-6 rounded-xl gap-2 font-bold">چوونەدەرەوە لە هەژمار</Button>
           </div>
        </div>

        {/* Version Info Section */}
        <div className="bg-[#1a1a1a] p-8 rounded-3xl border border-white/10 space-y-6 md:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-bold flex items-center gap-2 text-primary">
              <ShieldCheck className="w-5 h-5" /> ئەپلیکەیشن و وەشانی نوێ
            </h3>
            <Badge variant="outline" className="border-primary/30 text-primary">v2.1.0 Stable</Badge>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <p className="text-white/60 text-sm leading-relaxed">
                ئێمە بەردەوامین لە نوێکردنەوەی شیا سینەما بۆ پێشکەشکردنی باشترین ئەزموون بە ئێوەی خۆشەویست. لەم وەشانەدا کۆمەڵێک گۆڕانکاری گرنگمان ئەنجامداوە.
              </p>
              <ul className="space-y-3">
                {[
                  "گەڕانی پێشکەوتوو بەپێی ساڵ و جۆر",
                  "باشترکردنی پۆستەرەکان بۆ Vertical",
                  "چاککردنی کێشەی باربوونی فیلمەکان",
                  "سیستەمی نوێی ئەدمین و پاراستن"
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs text-white/80">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            
            <div className="bg-black/20 p-6 rounded-2xl border border-white/5 space-y-4 flex flex-col justify-between">
               <div className="space-y-4">
                 <div className="flex items-center gap-3">
                   <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                     <Bell className="w-5 h-5 text-primary" />
                   </div>
                   <h4 className="font-bold">ئاگاداربن لە نوێترینەکان</h4>
                 </div>
                 <p className="text-[10px] text-white/40 leading-relaxed">بۆ زانینی نوێترین فیلمەکان و زنجیرەکان، دەتوانیت پەیوەندی بکەیت بە سۆشیاڵ میدیاکانمان یان ئاگادارکەرەوەی ماڵپەڕ کارا بکەیت.</p>
               </div>
               <Button variant="outline" size="sm" className="w-full text-xs border-white/10 hover:bg-white/5 h-10 rounded-xl">بەردەوامبە</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SearchPage({ movies, favorites, toggleFavorite, onRequestMovie, initialCategory = "All" }: { movies: Movie[]; favorites: string[]; toggleFavorite: (id: string) => void; onRequestMovie: () => void; initialCategory?: string }) {
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(initialCategory);

  useEffect(() => {
    setSelectedCategory(initialCategory);
  }, [initialCategory]);
  const [selectedYear, setSelectedYear] = useState("All");
  const [sortBy, setSortBy] = useState("newest"); // newest, rating

  const categories = [
    { id: "All", label: "هەموو جۆرەکان" },
    { id: "Kurdish", label: "کوردی" },
    { id: "Action", label: "ئەکشن" },
    { id: "Drama", label: "دراما" },
    { id: "Comedy", label: "کۆمیدی" },
    { id: "Horror", label: "ترسناک" },
    { id: "Documentary", label: "دۆکیۆمێنتاری" },
  ];

  const years = ["All", ...Array.from(new Set(movies.map(m => m.year).filter(Boolean))).sort((a, b) => Number(b) - Number(a))];

  const filtered = movies.filter(m => {
    const matchesQuery = m.titleKu.toLowerCase().includes(query.toLowerCase()) || 
                        m.titleEn.toLowerCase().includes(query.toLowerCase());
    const matchesCategory = selectedCategory === "All" || m.category === selectedCategory;
    const matchesYear = selectedYear === "All" || String(m.year) === selectedYear;
    return matchesQuery && matchesCategory && matchesYear;
  }).sort((a, b) => {
    if (sortBy === "newest") {
      return Number(b.year) - Number(a.year);
    }
    if (sortBy === "rating") {
      return Number(b.rating) - Number(a.rating);
    }
    return 0;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-12 min-h-screen">
      <div className="space-y-8">
        {/* Search Bar */}
        <div className="max-w-3xl mx-auto relative group">
          <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 group-focus-within:text-primary transition-colors" />
          <input 
            type="text"
            autoFocus
            placeholder="بگەڕێ بۆ ناوی فیلم، زنجیرە، یان ئەکتەر..."
            className="w-full h-16 pr-12 rounded-3xl bg-white/5 border border-white/10 focus:border-primary text-xl outline-none transition-all px-4 shadow-2xl"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {/* Filters Grid */}
        <div className="bg-[#1a1a1a] p-6 rounded-3xl border border-white/5 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Category Filter */}
            <div className="space-y-3">
              <label className="text-sm font-bold text-white/40 block">جۆری فیلم</label>
              <div className="flex flex-wrap gap-2">
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(cat.id)}
                    className={cn(
                      "px-4 py-1.5 rounded-xl text-xs font-bold transition-all border",
                      selectedCategory === cat.id 
                        ? "bg-primary text-black border-primary" 
                        : "bg-white/5 text-white/60 border-white/5 hover:border-white/20 hover:text-white"
                    )}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Year Filter */}
            <div className="space-y-3">
              <label className="text-sm font-bold text-white/40 block">ساڵی بەرهەمهێنان</label>
              <select 
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 outline-none focus:border-primary text-sm"
              >
                {years.map(y => (
                  <option key={y} value={y} className="bg-[#1a1a1a]">{y === "All" ? "هەموو ساڵەکان" : y}</option>
                ))}
              </select>
            </div>

            {/* Sort Filter */}
            <div className="space-y-3">
              <label className="text-sm font-bold text-white/40 block">ڕیزبەندی بەپێی</label>
              <div className="flex gap-2">
                <button 
                  onClick={() => setSortBy("newest")}
                  className={cn("flex-1 py-2 rounded-xl text-xs font-bold border transition-all", sortBy === "newest" ? "bg-primary text-black border-primary" : "bg-white/5 text-white/40 border-white/10")}
                >
                  نوێترینەکان
                </button>
                <button 
                  onClick={() => setSortBy("rating")}
                  className={cn("flex-1 py-2 rounded-xl text-xs font-bold border transition-all", sortBy === "rating" ? "bg-primary text-black border-primary" : "bg-white/5 text-white/40 border-white/10")}
                >
                  بەرزترین نمرە
                </button>
              </div>
            </div>
          </div>
          
          {(query || selectedCategory !== "All" || selectedYear !== "All") && (
            <div className="pt-4 border-t border-white/5 flex justify-end">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => {
                  setQuery("");
                  setSelectedCategory("All");
                  setSelectedYear("All");
                  setSortBy("newest");
                }}
                className="text-white/40 hover:text-primary gap-2"
              >
                <X className="w-4 h-4" /> سڕینەوەی هەموو فلتەرەکان
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-8">
        <h2 className="text-2xl font-bold flex items-center justify-between">
          <div className="flex items-center gap-2">
            {query ? `ئەنجامەکانی گەڕان بۆ "${query}"` : "فیلمە دۆزراوەکان"}
            {!query && <TrendingUp className="w-5 h-5 text-primary" />}
          </div>
          <span className="text-white/40 text-lg">{filtered.length} فیلم</span>
        </h2>
        
        {filtered.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-y-12 gap-x-6">
            {filtered.map(movie => (
              <MovieCard key={movie.id} movie={movie} isFavorite={favorites.includes(movie.id)} onToggleFavorite={() => toggleFavorite(movie.id)} />
            ))}
          </div>
        ) : (
          <div className="text-center py-24 text-white/40 flex flex-col items-center gap-6">
             <Search className="w-16 h-16 opacity-10" />
             <div className="space-y-2">
               <p className="text-xl">هیچ ئەنجامێک نەدۆزرایەوە</p>
               <p className="text-sm">ئەگەر فیلمەکە بەردەست نییە، دەتوانیت داوای بکەیت.</p>
             </div>
             <div className="flex gap-4">
               <Button variant="link" onClick={() => { setQuery(""); setSelectedCategory("All"); setSelectedYear("All"); }} className="text-primary">سڕینەوەی فلتەرەکان</Button>
               <Button onClick={onRequestMovie} className="bg-white/5 border border-white/10 hover:border-primary/50 text-white rounded-xl">داواکردنی فیلم</Button>
             </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AdminPage({ movies, setStatus, isOwner, showConfirm }: { movies: Movie[], setStatus: (s: { type: "success" | "error" | null; message: string }) => void, isOwner: boolean, showConfirm: (title: string, message: string, onConfirm: () => void, onCancel?: () => void) => void }) {
  const [activeTab, setActiveTab] = useState<"movies" | "admins" | "requests">("movies");
  const [editingMovie, setEditingMovie] = useState<Partial<Movie> | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  // Admin management state
  const [adminsList, setAdminsList] = useState<any[]>([]);
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [newAdminUid, setNewAdminUid] = useState("");
  const [isLoadingAdmins, setIsLoadingAdmins] = useState(false);

  // Request management state
  const [requestsList, setRequestsList] = useState<any[]>([]);
  const [isLoadingRequests, setIsLoadingRequests] = useState(false);

  useEffect(() => {
    if (activeTab === "admins" && isOwner) {
      fetchAdmins();
    }
    if (activeTab === "requests") {
      fetchRequests();
    }
  }, [activeTab, isOwner]);

  const fetchRequests = async () => {
    setIsLoadingRequests(true);
    try {
      const q = query(collection(db, "requests"), orderBy("requestedAt", "desc"), limit(50));
      const querySnapshot = await getDocs(q);
      const list = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setRequestsList(list);
    } catch (error) {
      console.error("Error fetching requests", error);
    } finally {
      setIsLoadingRequests(false);
    }
  };

  const updateRequestStatus = async (id: string, newStatus: string) => {
    try {
      await updateDoc(doc(db, "requests", id), { status: newStatus });
      setStatus({ type: "success", message: "باری داواکارییەکە گۆڕدرا" });
      fetchRequests();
    } catch (error) {
      setStatus({ type: "error", message: "کێشەیەک ڕوویدا" });
    }
  };

  const deleteRequest = async (id: string) => {
    showConfirm(
      "سڕینەوەی داواکاری",
      "ئایا دڵنیایت لە سڕینەوەی ئەم داواکارییە؟",
      async () => {
        try {
          await deleteDoc(doc(db, "requests", id));
          fetchRequests();
          setStatus({ type: "success", message: "داواکارییەکە بە سەرکەوتوویی سڕایەوە" });
        } catch (error) {
          setStatus({ type: "error", message: "سڕینەوە سەرکەوتوو نەبوو" });
        }
      }
    );
  };

  const fetchAdmins = async () => {
    setIsLoadingAdmins(true);
    try {
      const q = query(collection(db, "admins"), orderBy("addedAt", "desc"));
      const querySnapshot = await getDocs(q);
      const list = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setAdminsList(list);
    } catch (error) {
      console.error("Error fetching admins", error);
    } finally {
      setIsLoadingAdmins(false);
    }
  };

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdminUid || !newAdminEmail) return;

    try {
      await setDoc(doc(db, "admins", newAdminUid), {
        email: newAdminEmail.toLowerCase(),
        addedAt: serverTimestamp(),
        role: "admin"
      });
      setStatus({ type: "success", message: "ئەدمینەکە بە سەرکەوتوویی زیادکرا" });
      setNewAdminUid("");
      setNewAdminEmail("");
      fetchAdmins();
    } catch (error) {
      setStatus({ type: "error", message: "هەڵەیەک ڕوویدا لە زیادکردنی ئەدمین" });
    }
  };

  const removeAdmin = async (uid: string, email: string) => {
    if (email === "abubakrsleman4@gmail.com") {
      setStatus({ type: "error", message: "ناتوانیت خۆت بڕیتەوە" });
      return;
    }
    
    showConfirm(
      "لادانی ئەدمین",
      `ئایا دڵنیایت لە لادانی ئەدمین ${email}؟`,
      async () => {
        try {
          await deleteDoc(doc(db, "admins", uid));
          setStatus({ type: "success", message: "ئەدمینەکە بە سەرکەوتوویی سڕایەوە" });
          fetchAdmins();
        } catch (error) {
          setStatus({ type: "error", message: "هەڵەیەک ڕوویدا لە سڕینەوەی ئەدمین" });
        }
      }
    );
  };

  const handleDelete = async (id: string) => {
    const targetMovie = movies.find(m => m.id === id);
    const movieTitle = targetMovie ? `"${targetMovie.titleKu || ''}"` : "ئەم فیلمە";
    
    showConfirm(
      "سڕینەوەی فیلمەکە",
      `ئایا دڵنیایت لە سڕینەوەی ${movieTitle}؟ ئەم کردارە بە یەکجاری دەیسڕێتەوە.`,
      async () => {
        try {
          await deleteDoc(doc(db, "movies", id));
          setStatus({ type: "success", message: "فیلمەکە بە سەرکەوتوویی سڕایەوە" });
        } catch (error) {
          setStatus({ type: "error", message: "هەڵەیەک ڕوویدا لە سڕینەوەی فیلمەکە" });
          handleFirestoreError(error, OperationType.DELETE, `movies/${id}`);
        }
      }
    );
  };

  const handleFeatureAllMovies = async () => {
    if (movies.length === 0) {
      setStatus({ type: "error", message: "هیچ فیلمێک بەردەست نییە بۆ فیتکردن" });
      return;
    }
    showConfirm(
      "فیتکردنی هەموو فیلمەکان",
      "ئایا دڵنیای لە فیتکردنی (کردنی بە نایاب لە لاپەڕەی سەرەکی) هەموو فیلمەکان پێکەوە؟",
      async () => {
        try {
          const batch = writeBatch(db);
          movies.forEach((movie) => {
            const movieRef = doc(db, "movies", movie.id);
            batch.update(movieRef, { isFeatured: true });
          });
          await batch.commit();
          setStatus({ type: "success", message: "سەرجەم فیلمەکان بە سەرکەوتوویی کران بە نایاب" });
        } catch (error: any) {
          console.error("Error featuring all movies: ", error);
          setStatus({ type: "error", message: `کێشەیەک لە فیتکردنی سەرجەم فیلمەکان ڕوویدا: ${error.message}` });
        }
      }
    );
  };

  const handleSave = async (movie: Partial<Movie>) => {
    setIsSaving(true);
    try {
      const cleanData = JSON.parse(JSON.stringify(movie));
      
      let finalMovieId = movie.id;

      if (movie.id) {
        const { id, ...data } = cleanData;
        await updateDoc(doc(db, "movies", id), {
          ...data,
          updatedAt: serverTimestamp()
        });
        setStatus({ type: "success", message: "فیلمەکە بە سەرکەوتوویی نوێکرایەوە" });
      } else {
        const docRef = await addDoc(collection(db, "movies"), {
          ...cleanData,
          createdAt: serverTimestamp()
        });
        finalMovieId = docRef.id;
        setStatus({ type: "success", message: "فیلمەکە بە سەرکەوتوویی بڵاوکرایەوە" });
      }

      setEditingMovie(null);
      setIsAdding(false);
    } catch (error) {
      console.error("Save error: ", error);
      setStatus({ type: "error", message: "هەڵەیەک ڕوویدا لە کاتی پاشەکەوتکردن" });
      handleFirestoreError(error, OperationType.WRITE, "movies");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-12 space-y-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-[#1a1a1a] p-8 rounded-3xl border border-white/10 gap-6">
        <div>
          <h1 className="text-4xl font-bold mb-2">بەڕێوبەرایەتی سستەم</h1>
          <p className="text-white/60">بەڕێوەبردنی فیلمەکان و ئەدمینەکانی ماڵپەڕ.</p>
        </div>
        
        <div className="flex bg-black/40 p-1.5 rounded-2xl border border-white/5">
          <button 
            onClick={() => setActiveTab("movies")}
            className={cn("px-6 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2", activeTab === "movies" ? "bg-primary text-black" : "text-white/40 hover:text-white")}
          >
            <Play className="w-4 h-4" /> فیلمەکان
          </button>
          {isOwner && (
            <button 
              onClick={() => setActiveTab("admins")}
              className={cn("px-6 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2", activeTab === "admins" ? "bg-primary text-black" : "text-white/40 hover:text-white")}
            >
              <Users className="w-4 h-4" /> ئەدمینەکان
            </button>
          )}
          <button 
            onClick={() => setActiveTab("requests")}
            className={cn("px-6 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2", activeTab === "requests" ? "bg-primary text-black" : "text-white/40 hover:text-white")}
          >
            <HelpCircle className="w-4 h-4" /> داواکارییەکان
          </button>
        </div>

        {activeTab === "movies" && (
          <div className="flex flex-wrap gap-3">
            <Button 
              onClick={handleFeatureAllMovies} 
              variant="outline" 
              className="border-yellow-500/20 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-500 font-bold h-14 px-6 rounded-2xl gap-2"
            >
              <Star className="w-5 h-5 fill-current" /> فیتکردنی هەموو فیلمەکان
            </Button>
            <Button onClick={() => setIsAdding(true)} className="bg-primary text-black font-bold h-14 px-8 rounded-2xl gap-2">
              <Plus className="w-5 h-5" /> زیادکردنی فیلم
            </Button>
          </div>
        )}
      </div>

      {activeTab === "movies" && (
        <>
          {(isAdding || editingMovie) && (
            <div className="bg-[#1a1a1a] p-8 rounded-3xl border border-primary/30 space-y-8 animate-in fade-in slide-in-from-top-4 duration-300">
              <h2 className="text-2xl font-bold text-primary">{isAdding ? "زیادکردنی فیلمی نوێ" : "دەستکاریکردنی فیلم"}</h2>
              <MovieForm 
                initialData={editingMovie || {}} 
                onSave={handleSave} 
                isSaving={isSaving}
                onCancel={() => { setIsAdding(false); setEditingMovie(null); }} 
              />
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {movies.map(movie => (
              <div key={movie.id} className="bg-[#1a1a1a] rounded-2xl overflow-hidden border border-white/10 flex flex-col">
                <div className="aspect-video relative">
                  <img src={movie.bannerUrl || undefined} alt={movie.titleKu || undefined} className="w-full h-full object-cover opacity-50" />
                  <div className="absolute inset-0 p-4 flex flex-col justify-between">
                    <div className="flex justify-between items-start w-full">
                      <Badge className="bg-primary text-black">{movie.category}</Badge>
                      {movie.isFeatured && (
                        <Badge className="bg-yellow-500/20 text-yellow-500 border border-yellow-500/30 gap-1 flex items-center py-1 px-2.5 rounded-full text-[10px] font-bold">
                          <Star className="w-3 h-3 fill-current" /> نایاب (فیت)
                        </Badge>
                      )}
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button 
                        size="icon" 
                        variant="secondary" 
                        onClick={async () => {
                          try {
                            const movieRef = doc(db, "movies", movie.id);
                            await updateDoc(movieRef, { isFeatured: !movie.isFeatured });
                            setStatus({ type: "success", message: movie.isFeatured ? "فیلمەکە لە بەشی سەرەکی لادرا" : "فیلمەکە کرایە فیلمی بەشی سەرەکی (نایاب)" });
                          } catch (err: any) {
                            setStatus({ type: "error", message: `کێشەیەک ڕوویدا: ${err.message}` });
                          }
                        }}
                        className={cn(
                          "border-none rounded-full",
                          movie.isFeatured ? "bg-yellow-500 text-black hover:bg-yellow-600" : "bg-white/10 hover:bg-white/20 text-white"
                        )}
                        title={movie.isFeatured ? "لادان لە سەرەکی" : "دانان وەک فیلمی سەرەکی (فیتچەر)"}
                      >
                        <Star className={cn("w-4 h-4", movie.isFeatured ? "fill-current" : "")} />
                      </Button>
                      <Button size="icon" variant="secondary" onClick={() => setEditingMovie(movie)} className="bg-white/10 hover:bg-white/20 text-white border-none rounded-full">
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button size="icon" variant="destructive" onClick={() => handleDelete(movie.id)} className="rounded-full shadow-lg">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="p-6 space-y-2">
                  <h3 className="text-xl font-bold">{movie.titleKu}</h3>
                  <p className="text-white/40 text-sm line-clamp-2">{movie.description}</p>
                  <div className="pt-4 flex items-center justify-between border-t border-white/5 text-xs text-white/60">
                    <span>{movie.year} • {movie.duration}</span>
                    <span className="flex items-center gap-1 text-primary"><Star className="w-3 h-3 fill-current" /> {movie.rating}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {activeTab === "admins" && (
        <div className="space-y-8 animate-in fade-in duration-500">
          <div className="bg-[#1a1a1a] p-8 rounded-3xl border border-white/10">
            <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" /> زیادکردنی ئەدمینی نوێ
            </h3>
            <form onSubmit={handleAddAdmin} className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-xs text-white/40 mr-2">Email</label>
                <Input value={newAdminEmail} onChange={e => setNewAdminEmail(e.target.value)} placeholder="email@example.com" className="bg-black/20 border-white/10" required />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-white/40 mr-2">User ID (UID)</label>
                <Input value={newAdminUid} onChange={e => setNewAdminUid(e.target.value)} placeholder="UID" className="bg-black/20 border-white/10" required />
              </div>
              <div className="flex items-end">
                <Button type="submit" className="w-full bg-primary text-black font-bold h-10 rounded-xl">زیادکردن</Button>
              </div>
            </form>
            <p className="mt-4 text-xs text-white/40">بۆ زانینی UID، پێویستە بەکارهێنەرەکە پێشتر یەکجار داخڵ بووبێت و لە Firestore لە بەشی Users بیدۆزیتەوە.</p>
          </div>

          <div className="bg-[#1a1a1a] p-8 rounded-3xl border border-white/10">
            <h3 className="text-xl font-bold mb-6">لیستی ئەدمینەکان</h3>
            <div className="space-y-2">
              {isLoadingAdmins ? (
                <div className="text-center py-10 opacity-40">داتا ئامادە دەکرێت...</div>
              ) : (
                adminsList.map(admin => (
                  <div key={admin.id} className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5 group">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <ShieldCheck className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-bold">{admin.email}</p>
                        <p className="text-xs text-white/40 font-mono">{admin.id}</p>
                      </div>
                      {admin.role === "owner" && <Badge className="bg-primary text-black">خاوەن</Badge>}
                    </div>
                    {admin.role !== "owner" && (
                      <Button 
                        size="icon" 
                        variant="ghost" 
                        onClick={() => removeAdmin(admin.id, admin.email)}
                        className="opacity-0 group-hover:opacity-100 text-white/40 hover:text-destructive hover:bg-destructive/10 rounded-full transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === "requests" && (
        <div className="space-y-8 animate-in fade-in duration-500">
          <div className="bg-[#1a1a1a] p-8 rounded-3xl border border-white/10">
            <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-primary" /> داواکارییەکانی بەکارهێنەران
            </h3>
            
            <div className="space-y-4">
              {isLoadingRequests ? (
                <div className="text-center py-20 opacity-40 italic">لە حالەتی بارکردندایە...</div>
              ) : requestsList.length === 0 ? (
                <div className="text-center py-20 opacity-40 italic">هیچ داواکارییەک نییە</div>
              ) : (
                <div className="grid gap-4">
                  {requestsList.map(req => (
                    <div key={req.id} className="bg-black/20 p-6 rounded-2xl border border-white/5 flex flex-col md:flex-row justify-between gap-6">
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <h4 className="text-xl font-bold text-primary">{req.movieTitle}</h4>
                          <Badge className={cn(
                            req.status === "pending" ? "bg-yellow-500/20 text-yellow-500 border-yellow-500/50" : 
                            req.status === "available" ? "bg-green-500/20 text-green-500 border-green-500/50" : 
                            "bg-red-500/20 text-red-500 border-red-500/50"
                          )}>
                            {req.status === "pending" ? "چاوەڕوانە" : req.status === "available" ? "بەردەستە" : "ڕەتکراوە"}
                          </Badge>
                        </div>
                        {req.note && <p className="text-sm text-white/60 italic">"{req.note}"</p>}
                        <div className="flex items-center gap-4 text-xs text-white/40">
                          <span>نێردراوە لەلایەن: <span className="text-white/60">{req.email}</span></span>
                          <span>بەروار: <span className="text-white/60">{req.requestedAt?.toDate().toLocaleDateString('ku-IQ')}</span></span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button 
                          onClick={() => updateRequestStatus(req.id, "available")}
                          className="bg-green-500/20 text-green-500 hover:bg-green-500/30 border border-green-500/30 py-2 h-auto text-xs"
                        >
                          بەردەستە
                        </Button>
                        <Button 
                          onClick={() => updateRequestStatus(req.id, "rejected")}
                          className="bg-red-500/20 text-red-500 hover:bg-red-500/30 border border-red-500/30 py-2 h-auto text-xs"
                        >
                          ڕەتکردنەوە
                        </Button>
                        <Button 
                          onClick={() => deleteRequest(req.id)}
                          variant="ghost"
                          className="text-white/20 hover:text-destructive"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function compressAndConvertImage(file: File, maxWidth: number, maxHeight: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;

        // Calculate scaling
        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(event.target?.result as string); // fallback to original base64
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        // Compress as jpeg with 0.8 quality to preserve nice visuals while staying light
        const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
        resolve(dataUrl);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}

function ImageUploadField({ 
  label, 
  value, 
  onChange, 
  placeholder, 
  helperText, 
  maxWidth = 800, 
  maxHeight = 1200 
}: { 
  label: string; 
  value: string; 
  onChange: (val: string) => void; 
  placeholder: string; 
  helperText: string; 
  maxWidth?: number; 
  maxHeight?: number; 
}) {
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const processFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("تکایە تەنها پەڕگەی وێنە هەڵبژێرە.");
      return;
    }
    setError(null);
    setIsProcessing(true);
    try {
      const base64 = await compressAndConvertImage(file, maxWidth, maxHeight);
      onChange(base64);
    } catch (err) {
      console.error("Image compression error: ", err);
      setError("کێشەیەک لە بارکردنی وێنەکە ڕوویدا.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const isBase64 = value ? value.startsWith("data:image/") : false;

  return (
    <div className="space-y-3">
      <label className="text-xs font-bold uppercase tracking-wider text-white/40 block">{label}</label>
      
      {/* Visual Preview / Drag Drop Box */}
      <div 
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        className={cn(
          "relative border border-dashed rounded-xl p-4 flex flex-col items-center justify-center gap-3 transition-colors min-h-[140px] text-center",
          dragActive ? "border-primary bg-primary/5" : "border-white/10 bg-black/10 hover:border-white/20",
          isBase64 ? "border-green-500/30 bg-green-500/5" : ""
        )}
      >
        {isProcessing ? (
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            <span className="text-xs text-white/50">وێنەکە ئامادە دەکرێت و دەپەسترێتەوە...</span>
          </div>
        ) : value ? (
          <div className="flex flex-col items-center gap-3 w-full">
            <img 
              src={value} 
              alt="دەستنیشانکراو" 
              className={cn("rounded-lg max-h-24 object-cover border border-white/10", label.includes("پان") ? "aspect-video" : "aspect-[2/3]")} 
            />
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-green-400 font-bold bg-green-500/10 px-2.5 py-1 rounded-full">
                {isBase64 ? "وێنەی بارکراو (ئۆفلاین)" : "لینکی دەرەکی"}
              </span>
              <button 
                type="button"
                onClick={() => onChange("")}
                className="text-[10px] text-red-400 hover:text-red-300 underline font-semibold"
              >
                سڕینەوەی وێنە
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-white/40 cursor-pointer w-full p-4">
            <Upload className="w-8 h-8 opacity-60 text-primary animate-pulse" />
            <div className="text-xs space-y-1">
              <p className="text-primary hover:underline cursor-pointer font-bold">لێرە کلیک بکە بۆ هەڵبژاردنی وێنە</p>
              <p className="text-white/30 text-[10px]">یان وێنەکە ڕابکێشە ئێرە (Drag & Drop)</p>
            </div>
            <input 
              type="file" 
              accept="image/*" 
              onChange={handleFileChange} 
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" 
            />
          </div>
        )}
      </div>

      {/* Manual URL Input fallback */}
      {!value && (
        <div className="space-y-1">
          <span className="text-[10px] text-white/30 block">یان دەتوانیت لینکی دەرەکی لێرە بنووسیت:</span>
          <Input 
            value={value} 
            onChange={e => onChange(e.target.value)} 
            placeholder={placeholder} 
            className="h-10 text-xs text-white/80"
          />
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
      <p className="text-[10px] text-white/30 leading-normal">{helperText}</p>
    </div>
  );
}

function MovieForm({ initialData, onSave, onCancel, isSaving }: { initialData: Partial<Movie>; onSave: (movie: Partial<Movie>) => void; onCancel: () => void; isSaving?: boolean }) {
  const [formData, setFormData] = useState<Partial<Movie>>({
    titleKu: "",
    titleEn: "",
    description: "",
    posterUrl: "",
    bannerUrl: "",
    trailerUrl: "",
    category: "Action",
    rating: 8.0,
    year: 2024,
    duration: "1h 30m",
    qualities: [{ label: "Server 1", url: "" }],
    subtitles: [],
    cast: [],
    isFeatured: false,
    bannerAlignment: "right",
    contentType: "movie",
    seasons: [],
    ...initialData
  });

  const addCastMember = () => {
    setFormData({
      ...formData,
      cast: [...(formData.cast || []), { name: "", role: "", imageUrl: "" }]
    });
  };

  const updateCastMember = (index: number, field: string, value: string) => {
    const updated = [...(formData.cast || [])];
    updated[index] = { ...updated[index], [field]: value };
    setFormData({ ...formData, cast: updated });
  };

  const removeCastMember = (index: number) => {
    setFormData({
      ...formData,
      cast: formData.cast?.filter((_, i) => i !== index)
    });
  };

  const addSubtitle = () => {
    setFormData({
      ...formData,
      subtitles: [...(formData.subtitles || []), { label: "Kurdish", lang: "ku", url: "" }]
    });
  };

  const updateSubtitle = (index: number, field: string, value: string) => {
    const updated = [...(formData.subtitles || [])];
    updated[index] = { ...updated[index], [field]: value };
    setFormData({ ...formData, subtitles: updated });
  };

  const removeSubtitle = (index: number) => {
    setFormData({
      ...formData,
      subtitles: formData.subtitles?.filter((_, i) => i !== index)
    });
  };

  const addServer = () => {
    setFormData({
      ...formData,
      qualities: [...(formData.qualities || []), { label: `Server ${(formData.qualities?.length || 0) + 1}`, url: "" }]
    });
  };

  const updateServer = (index: number, field: "label" | "url", value: string) => {
    const updated = [...(formData.qualities || [])];
    let finalValue = value;
    if (field === "url") {
      let trimmed = value.trim();
      if (trimmed.startsWith("<iframe") || trimmed.includes("src=")) {
        const match = trimmed.match(/src=["']([^"']+)["']/i);
        if (match && match[1]) {
          trimmed = match[1];
          if (trimmed.startsWith("//")) {
            trimmed = "https:" + trimmed;
          }
        }
      }
      
      // Auto-convert streamtape watch URLs (/v/) to embed URLs (/e/)
      if (trimmed.includes("streamtape") || trimmed.includes("streamta.pe") || trimmed.includes("shavetape")) {
        trimmed = trimmed.replace(/\/v\//, "/e/");
      }
      
      // Auto-convert doodstream watch URLs (/d/) to embed URLs (/e/)
      if (trimmed.includes("dood") && trimmed.includes("/d/")) {
        trimmed = trimmed.replace(/\/d\//, "/e/");
      }
      
      // Auto-update server label if generic
      const currentLabel = updated[index].label;
      if (!currentLabel || currentLabel.startsWith("Server ")) {
        if (trimmed.includes("streamtape") || trimmed.includes("streamta.pe") || trimmed.includes("shavetape")) {
          updated[index].label = "Streamtape";
        } else if (trimmed.includes("dood")) {
          updated[index].label = "DoodStream";
        }
      }
      
      finalValue = trimmed;
    }
    updated[index] = { ...updated[index], [field]: finalValue };
    setFormData({ ...formData, qualities: updated });
  };

  const removeServer = (index: number) => {
    setFormData({
      ...formData,
      qualities: formData.qualities?.filter((_, i) => i !== index)
    });
  };

  const addSeason = () => {
    const seasons = [...(formData.seasons || [])];
    const newSeasonNumber = seasons.length + 1;
    seasons.push({
      id: "season_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
      seasonNumber: newSeasonNumber,
      titleKu: `وەرزی ${newSeasonNumber}`,
      titleEn: `Season ${newSeasonNumber}`,
      episodes: []
    });
    setFormData({ ...formData, seasons });
  };

  const updateSeasonName = (sIdx: number, field: "titleKu" | "titleEn", value: string) => {
    const seasons = [...(formData.seasons || [])];
    seasons[sIdx] = { ...seasons[sIdx], [field]: value };
    setFormData({ ...formData, seasons });
  };

  const removeSeason = (sIdx: number) => {
    const seasons = formData.seasons?.filter((_, idx) => idx !== sIdx) || [];
    const updated = seasons.map((s, idx) => ({ ...s, seasonNumber: idx + 1 }));
    setFormData({ ...formData, seasons: updated });
  };

  const addEpisode = (sIdx: number) => {
    const seasons = [...(formData.seasons || [])];
    if (!seasons[sIdx].episodes) seasons[sIdx].episodes = [];
    const nextEpNumber = seasons[sIdx].episodes.length + 1;
    seasons[sIdx].episodes.push({
      id: "ep_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
      episodeNumber: nextEpNumber,
      titleKu: `ئەڵقەی ${nextEpNumber}`,
      titleEn: `Episode ${nextEpNumber}`,
      duration: "45خ",
      qualities: [{ label: "Server 1", url: "" }],
      subtitles: []
    });
    setFormData({ ...formData, seasons });
  };

  const updateEpisode = (sIdx: number, eIdx: number, field: string, value: any) => {
    const seasons = [...(formData.seasons || [])];
    seasons[sIdx].episodes[eIdx] = { ...seasons[sIdx].episodes[eIdx], [field]: value };
    setFormData({ ...formData, seasons });
  };

  const removeEpisode = (sIdx: number, eIdx: number) => {
    const seasons = [...(formData.seasons || [])];
    seasons[sIdx].episodes = seasons[sIdx].episodes.filter((_, idx) => idx !== eIdx);
    seasons[sIdx].episodes = seasons[sIdx].episodes.map((ep, idx) => ({ ...ep, episodeNumber: idx + 1 }));
    setFormData({ ...formData, seasons });
  };

  const addEpisodeServer = (sIdx: number, eIdx: number) => {
    const seasons = [...(formData.seasons || [])];
    const episode = seasons[sIdx].episodes[eIdx];
    episode.qualities = [...(episode.qualities || []), { label: `Server ${(episode.qualities?.length || 0) + 1}`, url: "" }];
    setFormData({ ...formData, seasons });
  };

  const updateEpisodeServer = (sIdx: number, eIdx: number, qIdx: number, field: "label" | "url", value: string) => {
    const seasons = [...(formData.seasons || [])];
    const episode = seasons[sIdx].episodes[eIdx];
    let finalValue = value;
    if (field === "url") {
      let trimmed = value.trim();
      if (trimmed.startsWith("<iframe") || trimmed.includes("src=")) {
        const match = trimmed.match(/src=["']([^"']+)["']/i);
        if (match && match[1]) {
          trimmed = match[1];
          if (trimmed.startsWith("//")) {
            trimmed = "https:" + trimmed;
          }
        }
      }
      
      // Auto-convert streamtape watch URLs (/v/) to embed URLs (/e/)
      if (trimmed.includes("streamtape") || trimmed.includes("streamta.pe") || trimmed.includes("shavetape")) {
        trimmed = trimmed.replace(/\/v\//, "/e/");
      }
      
      // Auto-convert doodstream watch URLs (/d/) to embed URLs (/e/)
      if (trimmed.includes("dood") && trimmed.includes("/d/")) {
        trimmed = trimmed.replace(/\/d\//, "/e/");
      }
      
      // Auto-update server label if generic
      const currentLabel = episode.qualities[qIdx].label;
      if (!currentLabel || currentLabel.startsWith("Server ")) {
        if (trimmed.includes("streamtape") || trimmed.includes("streamta.pe") || trimmed.includes("shavetape")) {
          episode.qualities[qIdx].label = "Streamtape";
        } else if (trimmed.includes("dood")) {
          episode.qualities[qIdx].label = "DoodStream";
        }
      }
      
      finalValue = trimmed;
    }
    episode.qualities[qIdx] = { ...episode.qualities[qIdx], [field]: finalValue };
    setFormData({ ...formData, seasons });
  };

  const removeEpisodeServer = (sIdx: number, eIdx: number, qIdx: number) => {
    const seasons = [...(formData.seasons || [])];
    seasons[sIdx].episodes[eIdx].qualities = seasons[sIdx].episodes[eIdx].qualities.filter((_, idx) => idx !== qIdx);
    setFormData({ ...formData, seasons });
  };

  const addEpisodeSubtitle = (sIdx: number, eIdx: number) => {
    const seasons = [...(formData.seasons || [])];
    const episode = seasons[sIdx].episodes[eIdx];
    episode.subtitles = [...(episode.subtitles || []), { label: "Kurdish", lang: "ku", url: "" }];
    setFormData({ ...formData, seasons });
  };

  const updateEpisodeSubtitle = (sIdx: number, eIdx: number, subIdx: number, field: string, value: string) => {
    const seasons = [...(formData.seasons || [])];
    const episode = seasons[sIdx].episodes[eIdx];
    if (!episode.subtitles) episode.subtitles = [];
    episode.subtitles[subIdx] = { ...episode.subtitles[subIdx], [field]: value };
    setFormData({ ...formData, seasons });
  };

  const removeEpisodeSubtitle = (sIdx: number, eIdx: number, subIdx: number) => {
    const seasons = [...(formData.seasons || [])];
    seasons[sIdx].episodes[eIdx].subtitles = seasons[sIdx].episodes[eIdx].subtitles?.filter((_, idx) => idx !== subIdx) || [];
    setFormData({ ...formData, seasons });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="space-y-4">
        <label className="text-sm font-medium text-white/50">ناوی فیلم (بە کوردی)</label>
        <Input value={formData.titleKu} onChange={e => setFormData({...formData, titleKu: e.target.value})} placeholder="بۆ نموونە: پێنجینەکانی جیهان" />
      </div>
      <div className="space-y-4">
        <label className="text-sm font-medium text-white/50">ناوی فیلم (بە ئینگلیزی)</label>
        <Input value={formData.titleEn} onChange={e => setFormData({...formData, titleEn: e.target.value})} placeholder="e.g. The World's Five" />
      </div>
      <div className="md:col-span-2 space-y-4">
        <label className="text-sm font-medium text-white/50">چیرۆک و کورتەی فیلم</label>
        <textarea 
          className="w-full bg-white/5 border border-white/10 rounded-xl p-4 min-h-[120px] outline-none focus:border-primary transition-all text-white"
          value={formData.description} 
          onChange={e => setFormData({...formData, description: e.target.value})} 
          placeholder="چیرۆکی فیلمەکە لێرە بنووسە..."
        />
      </div>
      
      <div className="bg-white/5 p-6 rounded-2xl border border-white/10 md:col-span-1 space-y-6">
        <h3 className="font-bold text-primary flex items-center gap-2 border-b border-white/5 pb-2">
          <Play className="w-4 h-4" /> وێنە و میدیا
        </h3>
        <ImageUploadField 
          label="پۆستەری درێژ (Portrait)" 
          value={formData.posterUrl || ""} 
          onChange={(val) => setFormData({...formData, posterUrl: val})} 
          placeholder="لینکی وێنەی پۆستەر" 
          helperText="ئەم وێنەیە لە لیستەکان و گەڕانەکاندا نیشان دەدرێت."
          maxWidth={600}
          maxHeight={900}
        />
        <ImageUploadField 
          label="وێنەی پان (Landscape Banner)" 
          value={formData.bannerUrl || ""} 
          onChange={(val) => setFormData({...formData, bannerUrl: val})} 
          placeholder="لینکی وێنەی پان" 
          helperText="ئەم وێنەیە لە بەکگراوند و سەرووی پەیجی فیلمەکە نیشان دەدرێت."
          maxWidth={1280}
          maxHeight={720}
        />
        <div className="space-y-4 pt-2">
          <label className="text-xs font-bold uppercase tracking-wider text-white/40 block">لینکی تڕەیلەر (YouTube/MP4)</label>
          <Input value={formData.trailerUrl} onChange={e => setFormData({...formData, trailerUrl: e.target.value})} placeholder="لینکی تڕەیلەری یوتیوب یان فیلم" />
        </div>
      </div>

      <div className="bg-white/5 p-6 rounded-2xl border border-white/10 md:col-span-1 space-y-6">
        <h3 className="font-bold text-primary flex items-center gap-2 border-b border-white/5 pb-2">
          <Settings className="w-4 h-4" /> زانیارییەکان
        </h3>
        <div className="space-y-3">
          <label className="text-sm font-medium block">جۆری ناوەڕۆک (Content Type)</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setFormData({ ...formData, contentType: "movie" })}
              className={cn(
                "py-3 rounded-xl border font-bold text-xs transition-all",
                (!formData.contentType || formData.contentType === "movie")
                  ? "bg-primary text-black border-primary shadow-lg shadow-primary/10"
                  : "bg-black/20 text-white/60 border-white/10 hover:bg-white/5"
              )}
            >
              فیلم (Movie)
            </button>
            <button
              type="button"
              onClick={() => setFormData({ ...formData, contentType: "series" })}
              className={cn(
                "py-3 rounded-xl border font-bold text-xs transition-all",
                (formData.contentType === "series")
                  ? "bg-primary text-black border-primary shadow-lg shadow-primary/10"
                  : "bg-black/20 text-white/60 border-white/10 hover:bg-white/5"
              )}
            >
              زنجیرە (Series)
            </button>
          </div>
        </div>
        <div className="space-y-4">
          <label className="text-sm font-medium">جۆر (Category)</label>
          <select 
            className="w-full h-12 px-3 bg-[#0a0a0a] border border-white/10 rounded-xl outline-none focus:ring-2 focus:ring-primary text-white"
            value={formData.category} 
            onChange={e => setFormData({...formData, category: e.target.value})}
          >
            {["Action", "Drama", "Kurdish", "Comedy", "Horror", "Documentary"].map(cat => <option key={cat} value={cat}>{cat}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <label className="text-xs font-medium text-white/40">نمرە</label>
            <Input type="number" step="0.1" value={formData.rating} onChange={e => setFormData({...formData, rating: parseFloat(e.target.value)})} />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-white/40">ساڵ</label>
            <Input type="number" value={formData.year} onChange={e => setFormData({...formData, year: parseInt(e.target.value)})} />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-white/40">ماوە</label>
            <Input value={formData.duration} onChange={e => setFormData({...formData, duration: e.target.value})} />
          </div>
        </div>
        
        <div className="flex items-center gap-3 bg-[#0a0a0a] border border-white/10 rounded-xl p-4 mt-6">
          <input 
            type="checkbox" 
            id="isFeatured"
            className="w-5 h-5 accent-primary rounded cursor-pointer border-white/20 focus:ring-0" 
            checked={!!formData.isFeatured} 
            onChange={e => setFormData({...formData, isFeatured: e.target.checked})} 
          />
          <label htmlFor="isFeatured" className="text-sm font-medium text-white/85 cursor-pointer select-none">
            دانان وەک فیلمی سەرەکی (لە بەشی سەرەوەی سایتەکە)
          </label>
        </div>

        {formData.isFeatured && (
          <div className="bg-[#0a0a0a] border border-white/10 rounded-xl p-4 mt-4 space-y-3 animate-in fade-in duration-300">
            <label className="text-xs font-bold uppercase tracking-wider text-white/40 block">ئاراستەی نوسینی سەر بۆرد (پۆستەری گەورە)</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setFormData({ ...formData, bannerAlignment: "right" })}
                className={cn(
                  "py-2 px-3 text-xs rounded-lg border font-bold transition-all",
                  formData.bannerAlignment === "right" || !formData.bannerAlignment
                    ? "bg-primary text-black border-primary" 
                    : "bg-white/5 text-white/60 border-white/10 hover:bg-white/10"
                )}
              >
                لای ڕاست (Default RTL)
              </button>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, bannerAlignment: "center" })}
                className={cn(
                  "py-2 px-3 text-xs rounded-lg border font-bold transition-all",
                  formData.bannerAlignment === "center" 
                    ? "bg-primary text-black border-primary" 
                    : "bg-white/5 text-white/60 border-white/10 hover:bg-white/10"
                )}
              >
                ناوەڕاست (Center)
              </button>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, bannerAlignment: "left" })}
                className={cn(
                  "py-2 px-3 text-xs rounded-lg border font-bold transition-all",
                  formData.bannerAlignment === "left" 
                    ? "bg-primary text-black border-primary" 
                    : "bg-white/5 text-white/60 border-white/10 hover:bg-white/10"
                )}
              >
                لای چەپ (Left)
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="md:col-span-2 bg-[#1a1a1a] p-8 rounded-3xl border border-white/10 space-y-6">
        <div className="flex justify-between items-center border-b border-white/5 pb-4">
           <h3 className="text-xl font-bold text-primary">ئەکتەرەکان (Cast)</h3>
           <Button onClick={addCastMember} variant="outline" size="sm" className="gap-2 border-primary/30 text-primary">
             <Plus className="w-4 h-4" /> زیادکردنی ئەکتەر
           </Button>
        </div>
        
        <div className="space-y-4">
           {formData.cast?.map((person, idx) => (
             <div key={idx} className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-white/5 p-4 rounded-xl border border-white/5">
                <div className="space-y-2">
                  <label className="text-xs text-white/30">ناوی ئەکتەر</label>
                  <Input value={person.name} onChange={e => updateCastMember(idx, "name", e.target.value)} placeholder="بۆ نموونە: Tom Cruise" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-white/30">ڕۆڵ</label>
                  <Input value={person.role} onChange={e => updateCastMember(idx, "role", e.target.value)} placeholder="بۆ نموونە: Actor" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-white/30">وێنەی ئەکتەر (URL)</label>
                  <Input value={person.imageUrl} onChange={e => updateCastMember(idx, "imageUrl", e.target.value)} placeholder="https://..." />
                </div>
                <div className="flex items-end pb-1">
                  <Button onClick={() => removeCastMember(idx)} variant="destructive" size="icon" className="rounded-lg w-full md:w-12 h-10">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
             </div>
           ))}
           {formData.cast?.length === 0 && (
             <p className="text-center py-8 text-white/20 italic">هیچ ئەکتەرێک نییە.</p>
           )}
        </div>
      </div>

      <div className="md:col-span-2 bg-[#1a1a1a] p-8 rounded-3xl border border-white/10 space-y-6">
        <div className="flex justify-between items-center border-b border-white/5 pb-4">
           <h3 className="text-xl font-bold text-primary">ژێرنووسەکان (VTT Files)</h3>
           <Button onClick={addSubtitle} variant="outline" size="sm" className="gap-2 border-primary/30 text-primary">
             <Plus className="w-4 h-4" /> زیادکردنی ژێرنووس
           </Button>
        </div>
        
        <div className="space-y-4">
           {formData.subtitles?.map((sub, idx) => (
             <div key={idx} className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-white/5 p-4 rounded-xl border border-white/5">
                <div className="space-y-2">
                  <label className="text-xs text-white/30">ناونیشان</label>
                  <Input value={sub.label} onChange={e => updateSubtitle(idx, "label", e.target.value)} placeholder="بۆ نموونە: کوردی" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-white/30">زمان (ISO)</label>
                  <Input value={sub.lang} onChange={e => updateSubtitle(idx, "lang", e.target.value)} placeholder="ku, en, ar" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-white/30">لینکی ژێرنووس (.vtt)</label>
                  <Input value={sub.url} onChange={e => updateSubtitle(idx, "url", e.target.value)} placeholder="https://..." />
                </div>
                <div className="flex items-end pb-1">
                  <Button onClick={() => removeSubtitle(idx)} variant="destructive" size="icon" className="rounded-lg w-full md:w-12 h-10">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
             </div>
           ))}
        </div>
      </div>

      <div className="md:col-span-2 bg-[#1a1a1a] p-8 rounded-3xl border border-white/10 space-y-6">
        <div className="flex justify-between items-center border-b border-white/5 pb-4">
           <h3 className="text-xl font-bold text-primary">سێرڤەرەکانی سەیرکردن</h3>
           <Button onClick={addServer} variant="outline" size="sm" className="gap-2 border-primary/30 text-primary">
             <Plus className="w-4 h-4" /> زیادکردنی سێرڤەر
           </Button>
        </div>
        
        <div className="space-y-4">
           {formData.qualities?.map((server, idx) => (
             <div key={idx} className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-white/5 p-4 rounded-xl border border-white/5 animate-in fade-in zoom-in-95 duration-200">
                <div className="space-y-2">
                  <label className="text-xs text-white/30">ناوی سێرڤەر</label>
                  <Input value={server.label} onChange={e => updateServer(idx, "label", e.target.value)} placeholder="بۆ نموونە: Server 1" />
                </div>
                <div className="md:col-span-2 space-y-2">
                  <label className="text-xs text-white/30">لینکی ڤیدیۆ (m3u8/mp4)</label>
                  <Input value={server.url} onChange={e => updateServer(idx, "url", e.target.value)} placeholder="https://..." />
                </div>
                <div className="flex items-end pb-1">
                  <Button onClick={() => removeServer(idx)} variant="destructive" size="icon" className="rounded-lg w-full md:w-12 h-10">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
             </div>
           ))}
           {formData.qualities?.length === 0 && (
             <p className="text-center py-8 text-white/20 italic">هیچ سێرڤەرێک نییە، تکایە دانەیەک زیاد بکە.</p>
           )}
        </div>
      </div>

      {/* TV Season & Episode management panel */}
      {formData.contentType === "series" && (
        <div className="md:col-span-2 bg-[#1a1a1a] p-8 rounded-3xl border border-white/10 space-y-6">
          <div className="flex justify-between items-center border-b border-white/5 pb-4">
            <div>
              <h3 className="text-xl font-bold text-primary">بەڕێوەبردنی وەرز و ئەڵقەکان</h3>
              <p className="text-xs text-white/40 mt-1">وەرزەکان و ئەڵقەکان لەگەڵ سەرچاوەکانی ڤیدیۆی تایبەت زیاد بکە.</p>
            </div>
            <Button 
              type="button" 
              onClick={addSeason} 
              variant="outline" 
              size="sm" 
              className="gap-2 border-primary/30 text-primary"
            >
              <Plus className="w-4 h-4" /> زیادکردنی وەرز (Season)
            </Button>
          </div>

          <div className="space-y-6">
            {formData.seasons?.map((season, sIdx) => (
              <div key={season.id} className="bg-white/5 p-6 rounded-2xl border border-white/5 space-y-4">
                <div className="flex items-center justify-between border-b border-white/5 pb-3">
                  <div className="flex flex-wrap items-center gap-4">
                    <span className="font-bold text-primary text-lg">وەرزی {season.seasonNumber}</span>
                    <Input 
                      className="max-w-[200px] h-9 text-xs font-bold"
                      value={season.titleKu || ""} 
                      onChange={(e) => updateSeasonName(sIdx, "titleKu", e.target.value)} 
                      placeholder="ناوی وەرز (کوردی) - ئارەزوومەندانە"
                    />
                    <Input 
                      className="max-w-[200px] h-9 text-xs"
                      value={season.titleEn || ""} 
                      onChange={(e) => updateSeasonName(sIdx, "titleEn", e.target.value)} 
                      placeholder="ناوی وەرز (English)"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button 
                      type="button" 
                      onClick={() => addEpisode(sIdx)} 
                      size="sm" 
                      variant="outline" 
                      className="border-green-500/30 text-green-400 hover:bg-green-500/10 text-xs px-3"
                    >
                      <Plus className="w-3.5 h-3.5" /> زیادکردنی ئەڵقە
                    </Button>
                    <Button 
                      type="button" 
                      onClick={() => removeSeason(sIdx)} 
                      size="icon" 
                      variant="destructive" 
                      className="w-8 h-8 rounded-lg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {/* Episodes List */}
                <div className="space-y-4">
                  {season.episodes?.map((episode, eIdx) => (
                    <div key={episode.id} className="bg-black/35 border border-white/5 p-4 rounded-xl space-y-4">
                      <div className="flex items-center justify-between border-b border-white/5 pb-2">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="bg-primary/20 text-primary text-xs font-bold px-2.5 py-1 rounded-md">ئەڵقەی {episode.episodeNumber}</span>
                          <Input 
                            className="max-w-[180px] h-8 text-xs font-bold"
                            value={episode.titleKu || ""} 
                            onChange={(e) => updateEpisode(sIdx, eIdx, "titleKu", e.target.value)} 
                            placeholder="ناوی ئەڵقە (بۆ نموونە: دەستپێک)"
                          />
                          <Input 
                            className="max-w-[180px] h-8 text-xs"
                            value={episode.titleEn || ""} 
                            onChange={(e) => updateEpisode(sIdx, eIdx, "titleEn", e.target.value)} 
                            placeholder="ناوی ئەڵقە (ئینگلیزی)"
                          />
                          <Input 
                            className="max-w-[100px] h-8 text-xs"
                            value={episode.duration || ""} 
                            onChange={(e) => updateEpisode(sIdx, eIdx, "duration", e.target.value)} 
                            placeholder="ماوە: 45خ"
                          />
                        </div>
                        <Button 
                          type="button" 
                          onClick={() => removeEpisode(sIdx, eIdx)} 
                          variant="ghost" 
                          size="icon" 
                          className="text-white/40 hover:text-red-500 hover:bg-red-500/10 w-8 h-8 rounded-lg"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>

                      {/* Episode server links */}
                      <div className="space-y-2 p-3 bg-white/5 rounded-lg border border-white/5">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs font-bold text-white/55">سێرڤەرەکانی ئەڵقە</span>
                          <Button 
                            type="button" 
                            onClick={() => addEpisodeServer(sIdx, eIdx)} 
                            size="sm" 
                            variant="outline" 
                            className="text-[10px] h-7 px-3 border-primary/20 text-primary hover:bg-primary/10"
                          >
                            <Plus className="w-3 w-3 inline mr-1" /> زیادکردنی سێرڤەر
                          </Button>
                        </div>
                        <div className="grid grid-cols-1 gap-2">
                          {episode.qualities?.map((quality, qIdx) => (
                            <div key={qIdx} className="flex gap-2 items-center">
                              <Input 
                                placeholder="Server 1, Player..." 
                                className="h-8 text-xs shrink-0 w-28" 
                                value={quality.label} 
                                onChange={(e) => updateEpisodeServer(sIdx, eIdx, qIdx, "label", e.target.value)} 
                              />
                              <Input 
                                placeholder="Embed URL / Direct video stream link..." 
                                className="h-8 text-xs" 
                                value={quality.url} 
                                onChange={(e) => updateEpisodeServer(sIdx, eIdx, qIdx, "url", e.target.value)} 
                              />
                              <Button 
                                type="button" 
                                onClick={() => removeEpisodeServer(sIdx, eIdx, qIdx)} 
                                variant="destructive" 
                                size="icon" 
                                className="w-8 h-8 rounded-lg shrink-0"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          ))}
                          {episode.qualities?.length === 0 && (
                            <p className="text-[10px] text-red-400 italic py-1">تکایە بەلایەنی کەمەوە یەک سێرڤەر دابنێ بۆ بینینی ئەڵقەکە.</p>
                          )}
                        </div>
                      </div>

                      {/* Episode subtitles */}
                      <div className="space-y-2 p-3 bg-white/5 rounded-lg border border-white/5">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs font-bold text-white/55">ژێرنووسەکانی ئەڵقە (VTT Files)</span>
                          <Button 
                            type="button" 
                            onClick={() => addEpisodeSubtitle(sIdx, eIdx)} 
                            size="sm" 
                            variant="outline" 
                            className="text-[10px] h-7 px-3 border-primary/20 text-primary hover:bg-primary/10"
                          >
                            <Plus className="w-3 w-3 inline mr-1" /> زیادکردنی ژێرنووس
                          </Button>
                        </div>
                        <div className="grid grid-cols-1 gap-2">
                          {episode.subtitles?.map((sub, subIdx) => (
                            <div key={subIdx} className="flex gap-2 items-center">
                              <Input 
                                placeholder="ناونیشان: کوردی" 
                                className="h-8 text-xs shrink-0 w-28" 
                                value={sub.label} 
                                onChange={(e) => updateEpisodeSubtitle(sIdx, eIdx, subIdx, "label", e.target.value)} 
                              />
                              <Input 
                                placeholder="ISO: ku" 
                                className="h-8 text-xs shrink-0 w-20" 
                                value={sub.lang} 
                                onChange={(e) => updateEpisodeSubtitle(sIdx, eIdx, subIdx, "lang", e.target.value)} 
                              />
                              <Input 
                                placeholder="https://...vtt" 
                                className="h-8 text-xs" 
                                value={sub.url} 
                                onChange={(e) => updateEpisodeSubtitle(sIdx, eIdx, subIdx, "url", e.target.value)} 
                              />
                              <Button 
                                type="button" 
                                onClick={() => removeEpisodeSubtitle(sIdx, eIdx, subIdx)} 
                                variant="destructive" 
                                size="icon" 
                                className="w-8 h-8 rounded-lg shrink-0"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>

                    </div>
                  ))}
                  {season.episodes?.length === 0 && (
                    <p className="text-xs text-white/30 italic text-center py-6">هیچ ئەڵقەیەک نییە، تکایە دانەیەک زیاد بکە.</p>
                  )}
                </div>
              </div>
            ))}
            {formData.seasons?.length === 0 && (
              <div className="text-center py-12 border border-dashed border-white/10 rounded-2xl flex flex-col items-center justify-center gap-2">
                <Star className="w-8 h-8 text-white/10 animate-bounce" />
                <p className="text-sm text-white/40">هیچ وەرزێک نییە، دەستبکە بە زیادکردنی وەرز بۆ زنجیرەکە.</p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="md:col-span-2 pt-8 flex justify-end gap-4 border-t border-white/10">
        <Button variant="ghost" onClick={onCancel} className="h-14 px-8 rounded-2xl">پاشگەزبوونەوە</Button>
        <Button 
          onClick={() => onSave(formData)} 
          disabled={!formData.titleKu || (formData.contentType !== "series" && (formData.qualities?.length || 0) === 0) || isSaving}
          className="bg-primary text-black font-bold h-14 px-12 rounded-2xl gap-2 shadow-lg shadow-primary/20 hover:scale-105 transition-transform"
        >
          {isSaving ? (
            <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
          ) : (
            <Save className="w-5 h-5" />
          )}
          {isSaving ? "چاوەڕوانبە..." : "پاشکەوتکردن و بڵاوکردنەوە"}
        </Button>
      </div>
    </div>
  );
}
function RequestMovieModal({ user, onClose, setStatus }: { user: User | null; onClose: () => void; setStatus: (s: { type: "success" | "error" | null; message: string }) => void }) {
  const [movieTitle, setMovieTitle] = useState("");
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setStatus({ type: "error", message: "تکایە سەرەتا داخڵ ببە" });
      return;
    }
    if (!movieTitle.trim()) return;

    setIsSubmitting(true);
    try {
      await addDoc(collection(db, "requests"), {
        userId: user.uid,
        email: user.email,
        movieTitle: movieTitle.trim(),
        note: note.trim(),
        status: "pending",
        requestedAt: serverTimestamp()
      });
      setStatus({ type: "success", message: "داواکارییەکەت بە سەرکەوتوویی نێردرا" });
      onClose();
    } catch (error) {
      setStatus({ type: "error", message: "هەڵەیەک ڕوویدا لە ناردنی داواکاری" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }} 
        animate={{ opacity: 1 }} 
        onClick={onClose}
        className="absolute inset-0 bg-black/80 backdrop-blur-md" 
      />
      <motion.div 
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        className="relative bg-[#1a1a1a] border border-white/10 w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl"
      >
        <div className="p-8 space-y-6">
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <h2 className="text-2xl font-bold flex items-center gap-2">
                <HelpCircle className="w-6 h-6 text-primary" /> داواکردنی فیلم
              </h2>
              <p className="text-white/40 text-sm">فیلمێک یان زنجیرەیەک کە بەردەست نییە داوا بکە.</p>
            </div>
            <Button onClick={onClose} variant="ghost" size="icon" className="text-white/40 hover:text-white rounded-full">
              <X className="w-6 h-6" />
            </Button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-bold text-white/60 mr-2">ناوی فیلم یان زنجیرە</label>
              <Input 
                value={movieTitle} 
                onChange={e => setMovieTitle(e.target.value)} 
                placeholder="بۆ نموونە: Inception" 
                className="bg-black/20 border-white/10 h-12"
                required 
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-bold text-white/60 mr-2">تێبینی (ئارەزوومەندانە)</label>
              <textarea 
                value={note} 
                onChange={e => setNote(e.target.value)} 
                placeholder="وەرزی چەندەم؟ یان وردەکاری تر..." 
                className="w-full bg-black/20 border border-white/10 rounded-xl p-4 min-h-[100px] outline-none focus:border-primary text-sm transition-all"
              />
            </div>
            <Button 
              type="submit" 
              disabled={isSubmitting || !movieTitle.trim()} 
              className="w-full bg-primary text-black font-bold h-14 rounded-2xl text-lg mt-4"
            >
              Nێردنی داواکاری
            </Button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}

function ChangelogModal({ onClose }: { onClose: () => void }) {
  const updates = [
    { title: "گەڕانی پێشکەوتوو", description: "زیادکردنی فلتەری ساڵ، جۆر، و ڕیزبەندی لە بەشی گەڕان.", icon: <Search className="w-5 h-5 text-primary" /> },
    { title: "دیزاینی نوێی پۆستەرەکان", description: "کالیکردنی شێوازی پۆستەرەکان بۆ شێوەی ستوونی (Vertical) بۆ بینینێکی جوانتر.", icon: <Star className="w-5 h-5 text-primary" /> },
    { title: "بەڕێوبەرایەتی پارێزراو", description: "نوێکردنەوەی سیستەمی ئەدمینەکان و دیاریکردنی ئاستی خاوەندارێتی (Owner).", icon: <ShieldCheck className="w-5 h-5 text-primary" /> },
    { title: "خێراترکردنی سستەم", description: "باشترکردنی خێرایی باربوونی داتاکان و وێنەکان لە مۆبایل و کۆمپیوتەر.", icon: <TrendingUp className="w-5 h-5 text-primary" /> },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }} 
        animate={{ opacity: 1 }} 
        onClick={onClose}
        className="absolute inset-0 bg-black/80 backdrop-blur-md" 
      />
      <motion.div 
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        className="relative bg-[#1a1a1a] border border-white/10 w-full max-w-xl rounded-3xl overflow-hidden shadow-2xl"
      >
        <div className="p-8 border-b border-white/5 bg-gradient-to-br from-primary/10 to-transparent">
          <div className="flex justify-between items-start mb-6">
            <div className="space-y-1">
              <Badge className="bg-primary text-black font-bold mb-2">وەشانی نوێ v2.1.0</Badge>
              <h2 className="text-3xl font-bold">چی نوێیە لەم وەشانەدا؟</h2>
            </div>
            <Button onClick={onClose} variant="ghost" size="icon" className="text-white/40 hover:text-white rounded-full">
              <X className="w-6 h-6" />
            </Button>
          </div>

          <div className="space-y-6">
            {updates.map((update, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 }}
                className="flex gap-4 items-start bg-white/5 p-4 rounded-2xl border border-white/5"
              >
                <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center shrink-0">
                  {update.icon}
                </div>
                <div>
                  <h4 className="font-bold text-lg">{update.title}</h4>
                  <p className="text-white/60 text-sm leading-relaxed">{update.description}</p>
                </div>
              </motion.div>
            ))}
          </div>

          <Button onClick={onClose} className="w-full mt-8 bg-primary text-black font-bold h-14 rounded-2xl text-lg">
            دەستپێبکە
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

function Footer({ onShowChangelog }: { onShowChangelog: () => void }) {
  return (
    <footer className="bg-[#0a0a0a] border-t border-white/5 py-16">
      <div className="max-w-7xl mx-auto px-4 md:px-8 flex flex-col md:flex-row justify-between items-start gap-12">
        <div className="space-y-6 max-w-sm">
          <div className="flex items-center gap-2">
             <div className="bg-primary p-1.5 rounded-lg">
                <Play className="fill-black w-5 h-5 text-black" />
             </div>
             <span className="text-2xl font-bold tracking-tighter text-white">SHEA <span className="text-primary text-gold-500">CINEMA</span></span>
          </div>
          <p className="text-white/40 leading-relaxed text-sm">
            شیای سینەما، یەکەمین و گەورەترین پلاتفۆرمی کوردی بۆ بینینی فیلم و زنجیرە جیهانییەکان بە ژێرنووسی کوردی و کوالێتی بەرز.
          </p>
          <div className="pt-4">
             <button 
              onClick={onShowChangelog}
              className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-xs font-bold text-white/60 hover:text-primary hover:border-primary/30 transition-all"
             >
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                چی نوێیە لەم وەشانەدا؟ (v2.1.0)
             </button>
          </div>
        </div>

            <div className="space-y-4">
              <h4 className="font-bold text-white uppercase tracking-wider">سەرچاوەکان</h4>
              <ul className="space-y-2 text-white/40">
                <li><Link to="/" className="hover:text-primary">سەرەتا</Link></li>
                <li><Link to="/movies" className="hover:text-primary">فیلمەکان</Link></li>
                <li><Link to="/series" className="hover:text-primary">زنجیرەکان</Link></li>
              </ul>
            </div>
            <div className="space-y-4">
              <h4 className="font-bold text-white uppercase tracking-wider">یاسایی</h4>
              <ul className="space-y-2 text-white/40">
                <li><Link to="/terms" className="hover:text-primary">مەرجەکانی بەکارهێنان</Link></li>
                <li><Link to="/privacy" className="hover:text-primary">پاراستنی زانیارییەکان</Link></li>
                <li><Link to="/copyright" className="hover:text-primary">مافی لەبەرگرتنەوە</Link></li>
              </ul>
            </div>
            <div className="space-y-4">
              <h4 className="font-bold text-white uppercase tracking-wider">پەیوەندی</h4>
              <ul className="space-y-2 text-white/40">
                <li><Link to="/support" className="hover:text-primary">پشتگیری</Link></li>
                <li><Link to="/about" className="hover:text-primary">دەربارەی ئێمە</Link></li>
                <li><Link to="/ads" className="hover:text-primary">ڕیکلام</Link></li>
              </ul>
            </div>
      </div>
      <div className="max-w-7xl mx-auto px-4 md:px-8 mt-16 pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between gap-4 text-white/20 text-xs">
        <p>© 2024 Shea Cinema. هەموو مافەکانی پارێزراوە.</p>
        <div className="flex gap-4">
          <span>دیزاین کراوە لەلایەن AI Shea</span>
        </div>
      </div>
    </footer>
  );
}

export default App;
