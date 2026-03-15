import React, { useState, useEffect, Component } from 'react';
import { 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  setDoc, 
  orderBy,
  limit,
  deleteDoc
} from 'firebase/firestore';
import { 
  Plus, 
  Minus, 
  History, 
  Wallet, 
  LogOut, 
  LogIn, 
  AlertCircle,
  TrendingDown,
  TrendingUp,
  Utensils,
  Calendar,
  Trash2,
  Edit2,
  Settings,
  Bell,
  X
} from 'lucide-react';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import emailjs from '@emailjs/browser';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { auth, db, signInWithGoogle, logout } from './firebase';

// Utility for Tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Shared: mọi user dùng chung 1 budget và 1 settings (chỉ admin cấu hình)
const SHARED_BUDGET_ID = 'default';
const SHARED_SETTINGS_ID = 'default';

// --- Types ---
interface Budget {
  id?: string;
  uid?: string;
  totalBudget: number;
  currentBalance: number;
  updatedAt: string;
}

interface Expense {
  id?: string;
  uid: string;
  amount: number;
  description: string;
  date: string;
  type: 'expense' | 'income';
}

interface NotificationSettings {
  id?: string;
  uid?: string;
  emails: string[];
  emailjsServiceId?: string;
  emailjsTemplateId?: string;
  emailjsPublicKey?: string;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

// --- Error Handling ---
function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any): ErrorBoundaryState {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#F8F9FA] p-4 text-slate-900">
          <div className="max-w-md w-full bg-white rounded-[2rem] shadow-xl p-8 text-center border border-slate-200">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2">Đã có lỗi xảy ra</h1>
            <p className="text-slate-500 mb-6">
              {this.state.error?.message?.includes('{') 
                ? "Lỗi quyền truy cập Firestore. Vui lòng kiểm tra cấu hình." 
                : "Ứng dụng gặp sự cố không mong muốn."}
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="bg-white text-black px-8 py-3 rounded-full font-bold hover:bg-white/90 transition-colors"
            >
              Thử lại
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Components ---

const Card = ({ children, className }: { children: React.ReactNode, className?: string }) => (
  <div className={cn("bg-white rounded-[2.5rem] border border-slate-200 p-6 md:p-8 shadow-sm", className)}>
    {children}
  </div>
);

const Button = ({ 
  children, 
  onClick, 
  variant = 'primary', 
  className,
  disabled 
}: { 
  children: React.ReactNode, 
  onClick?: () => void, 
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger',
  className?: string,
  disabled?: boolean
}) => {
  const variants = {
    primary: "bg-slate-900 text-white hover:bg-slate-800 shadow-md",
    secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200",
    outline: "border border-slate-200 text-slate-900 hover:bg-slate-50",
    ghost: "text-slate-500 hover:text-slate-900 hover:bg-slate-50",
    danger: "bg-red-50 text-red-600 hover:bg-red-100"
  };

  return (
    <button 
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "px-8 py-4 rounded-2xl font-bold transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-3",
        variants[variant],
        className
      )}
    >
      {children}
    </button>
  );
};

// --- Main App ---

function BudgetTracker() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [notifSettings, setNotifSettings] = useState<NotificationSettings | null>(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isAddingMoney, setIsAddingMoney] = useState(false);
  const [isEditingBalance, setIsEditingBalance] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  const ADMIN_EMAIL = "nguyenvancuong13102001t@gmail.com";

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        setIsAdmin(u.email === ADMIN_EMAIL);
        setDoc(doc(db, 'users', u.uid), {
          uid: u.uid,
          email: u.email,
          role: u.email === ADMIN_EMAIL ? 'admin' : 'user'
        }, { merge: true }).catch(e => console.error("Error updating user role:", e));
      } else {
        setIsAdmin(false);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Budget, Expenses & Settings Sync (1 budget chung cho tất cả user)
  useEffect(() => {
    if (!user) return;

    const budgetRef = doc(db, 'budgets', SHARED_BUDGET_ID);
    const unsubBudget = onSnapshot(budgetRef, (snapshot) => {
      if (snapshot.exists()) {
        setBudget({ id: snapshot.id, ...snapshot.data() } as Budget);
      } else {
        const initialBudget = {
          totalBudget: 5000000,
          currentBalance: 5000000,
          updatedAt: new Date().toISOString()
        };
        setDoc(budgetRef, initialBudget)
          .then(() => setBudget({ id: SHARED_BUDGET_ID, ...initialBudget } as Budget))
          .catch(e => handleFirestoreError(e, OperationType.WRITE, 'budgets'));
      }
    });

    const expensesQuery = query(
      collection(db, 'expenses'),
      orderBy('date', 'desc'),
      limit(50)
    );
    const unsubExpenses = onSnapshot(expensesQuery, (snapshot) => {
      setExpenses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Expense)));
    });

    const settingsRef = doc(db, 'settings', SHARED_SETTINGS_ID);
    const unsubSettings = onSnapshot(settingsRef, (snapshot) => {
      if (snapshot.exists()) {
        setNotifSettings({ id: snapshot.id, ...snapshot.data() } as NotificationSettings);
      } else if (user?.email === ADMIN_EMAIL) {
        const initialSettings = { emails: [user.email || ''] };
        setDoc(settingsRef, initialSettings)
          .then(() => setNotifSettings({ id: SHARED_SETTINGS_ID, ...initialSettings } as NotificationSettings))
          .catch(e => console.error('Init shared settings:', e));
      } else {
        setNotifSettings(null);
      }
    });

    return () => {
      unsubBudget();
      unsubExpenses();
      unsubSettings();
    };
  }, [user]);

  const sendNotification = async (newBalance: number, type: string, amount: number) => {
    if (!notifSettings || notifSettings.emails.length === 0 || !user) return;
    
    const { emailjsServiceId, emailjsTemplateId, emailjsPublicKey } = notifSettings;

    if (!emailjsServiceId || !emailjsTemplateId || !emailjsPublicKey) {
      console.warn("EmailJS chưa được cấu hình trong Cài đặt.");
      return;
    }

    const typeLabel = type === 'expense' ? 'Chi tiêu' : type === 'income' ? 'Nạp tiền' : 'Cập nhật';
    const formattedAmount = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
    const formattedBalance = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(newBalance);

    try {
      // Gửi email cho từng địa chỉ trong danh sách
      for (const email of notifSettings.emails) {
        await emailjs.send(
          emailjsServiceId,
          emailjsTemplateId,
          {
            to_email: email,
            user_email: user.email,
            transaction_type: typeLabel,
            amount: formattedAmount,
            new_balance: formattedBalance,
            sign: type === 'expense' ? '-' : '+'
          },
          emailjsPublicKey
        );
      }
      console.log("Emails sent successfully via EmailJS");
    } catch (error) {
      console.error("Error sending email via EmailJS:", error);
    }
  };

  const handleTransaction = async (type: 'expense' | 'income') => {
    if (!user || !budget || !amount) return;
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) return;

    try {
      if (editingExpense) {
        // Cập nhật giao dịch cũ
        const oldAmount = editingExpense.amount;
        const oldType = editingExpense.type;
        
        await updateDoc(doc(db, 'expenses', editingExpense.id!), {
          amount: numAmount,
          description: description || (type === 'expense' ? 'Mua đồ ăn' : 'Nạp thêm tiền'),
        });

        // Tính toán lại số dư
        let balanceDiff = 0;
        if (oldType === 'expense') {
          balanceDiff += oldAmount; // Hoàn trả số tiền cũ
        } else {
          balanceDiff -= oldAmount; // Trừ đi số tiền thu nhập cũ
        }

        if (type === 'expense') {
          balanceDiff -= numAmount; // Trừ đi số tiền chi tiêu mới
        } else {
          balanceDiff += numAmount; // Cộng thêm số tiền thu nhập mới
        }

        const newBalance = budget.currentBalance + balanceDiff;

        if (budget.id) {
          await updateDoc(doc(db, 'budgets', budget.id), {
            currentBalance: newBalance,
            updatedAt: new Date().toISOString()
          });
        }

        sendNotification(newBalance, 'chỉnh_sửa', numAmount);
      } else {
        // Thêm giao dịch mới
        await addDoc(collection(db, 'expenses'), {
          uid: user.uid,
          amount: numAmount,
          description: description || (type === 'expense' ? 'Mua đồ ăn' : 'Nạp thêm tiền'),
          date: new Date().toISOString(),
          type
        });

        const newBalance = type === 'expense' 
          ? budget.currentBalance - numAmount 
          : budget.currentBalance + numAmount;

        if (budget.id) {
          await updateDoc(doc(db, 'budgets', budget.id), {
            currentBalance: newBalance,
            updatedAt: new Date().toISOString()
          });
        }

        sendNotification(newBalance, type, numAmount);
      }

      setAmount('');
      setDescription('');
      setIsAdding(false);
      setIsAddingMoney(false);
      setEditingExpense(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'transaction');
    }
  };

  const handleEditBalance = async () => {
    if (!user || !budget || !amount || !isAdmin) return;
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount)) return;

    try {
      if (budget.id) {
        await updateDoc(doc(db, 'budgets', budget.id), {
          currentBalance: numAmount,
          updatedAt: new Date().toISOString()
        });
      }
      sendNotification(numAmount, 'manual_edit', 0);
      setAmount('');
      setIsEditingBalance(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'budgets');
    }
  };

  const handleDeleteExpense = async (expense: Expense) => {
    if (!expense.id) return;
    if (!isAdmin && expense.uid !== user?.uid) return;

    if (!confirm('Xóa giao dịch này khỏi lịch sử?')) return;

    try {
      await deleteDoc(doc(db, 'expenses', expense.id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'expenses');
    }
  };

  const handleStartEditExpense = (expense: Expense) => {
    setEditingExpense(expense);
    setAmount(expense.amount.toString());
    setDescription(expense.description);
    if (expense.type === 'expense') {
      setIsAdding(true);
      setIsAddingMoney(false);
    } else {
      setIsAddingMoney(true);
      setIsAdding(false);
    }
  };

  const handleAddEmail = async () => {
    if (!isAdmin || !newEmail || !notifSettings) return;
    if (!newEmail.includes('@')) return;

    const updatedEmails = [...notifSettings.emails, newEmail];
    try {
      if (notifSettings.id) {
        await updateDoc(doc(db, 'settings', SHARED_SETTINGS_ID), { emails: updatedEmails });
      }
      setNewEmail('');
    } catch (e) {
      console.error(e);
    }
  };

  const handleRemoveEmail = async (emailToRemove: string) => {
    if (!isAdmin || !notifSettings) return;
    const updatedEmails = notifSettings.emails.filter(e => e !== emailToRemove);
    try {
      if (notifSettings.id) {
        await updateDoc(doc(db, 'settings', SHARED_SETTINGS_ID), { emails: updatedEmails });
      }
    } catch (e) {
      console.error(e);
    }
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val);
  };

  const paginatedExpenses = expenses.slice(0, currentPage * ITEMS_PER_PAGE);
  const hasMore = expenses.length > paginatedExpenses.length;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8F9FA]">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
          <Utensils className="w-10 h-10 text-slate-200" />
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] flex flex-col items-center justify-center p-6 text-slate-900">
        <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} className="max-w-md w-full text-center">
          <div className="w-20 h-20 md:w-24 md:h-24 bg-slate-900 rounded-[2rem] flex items-center justify-center mx-auto mb-8 md:mb-10 shadow-xl">
            <Utensils className="w-10 h-10 md:w-12 md:h-12 text-white" />
          </div>
          <h1 className="text-4xl md:text-6xl font-black mb-4 md:mb-6 tracking-tighter italic uppercase">Quản lý<br/>Ăn uống</h1>
          <p className="text-slate-500 mb-8 md:mb-12 text-lg md:text-xl font-medium">Nâng tầm thói quen chi tiêu của bạn.</p>
          <Button onClick={signInWithGoogle} className="w-full py-4 md:py-5 text-lg md:text-xl rounded-[1.5rem]">
            <LogIn className="w-6 h-6" />
            Đăng nhập với Google
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-slate-900 font-sans selection:bg-slate-900 selection:text-white">
      {/* Header */}
      <header className="max-w-xl mx-auto p-6 md:p-8 flex items-center justify-between">
        <div className="flex items-center gap-3 md:gap-4">
          <div className="w-10 h-10 md:w-12 md:h-12 bg-slate-900 rounded-2xl flex items-center justify-center shadow-md">
            <Utensils className="w-5 h-5 md:w-6 md:h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-black italic tracking-tighter uppercase">Food Budget</h1>
            {isAdmin && <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Quản trị viên</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 md:gap-2">
          {isAdmin && (
            <button onClick={() => setShowSettings(true)} className="p-2 md:p-3 hover:bg-slate-100 rounded-2xl transition-all">
              <Settings className="w-5 h-5 md:w-6 md:h-6 text-slate-400" />
            </button>
          )}
          <button onClick={logout} className="p-2 md:p-3 hover:bg-slate-100 rounded-2xl transition-all">
            <LogOut className="w-5 h-5 md:w-6 md:h-6 text-slate-400" />
          </button>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-6 md:px-8 space-y-8 md:space-y-10 pb-32">
        {/* Balance Display */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-slate-200 to-transparent rounded-[3rem] blur opacity-25 group-hover:opacity-50 transition duration-1000"></div>
            <Card className="relative bg-white border-slate-200 p-8 md:p-10">
              <div className="flex items-center justify-between mb-8 md:mb-10">
                <div className="flex items-center gap-3 text-slate-400">
                  <Wallet className="w-5 h-5" />
                  <span className="text-xs md:text-sm font-bold uppercase tracking-[0.2em]">Số dư hiện tại</span>
                </div>
                {isAdmin && (
                  <button onClick={() => { setIsEditingBalance(true); setAmount(budget?.currentBalance.toString() || ''); }} className="p-2 hover:bg-slate-50 rounded-xl transition-all">
                    <Edit2 className="w-5 h-5 text-slate-300 hover:text-slate-900" />
                  </button>
                )}
              </div>
              
              <div className="text-5xl md:text-7xl font-black tracking-tighter mb-4 tabular-nums">
                {budget ? formatCurrency(budget.currentBalance).replace('₫', '') : '0'}
                <span className="text-xl md:text-2xl ml-2 text-slate-300 font-normal not-italic">VND</span>
              </div>
              
              <div className="flex items-center gap-2 text-slate-400 text-xs md:text-sm font-medium">
                <Calendar className="w-4 h-4" />
                Cập nhật lần cuối {budget ? format(new Date(budget.updatedAt), 'dd/MM, HH:mm') : 'Chưa có'}
              </div>
            </Card>
          </div>
        </motion.div>

        {/* Actions */}
        <div className={cn("grid gap-4 md:gap-6", isAdmin ? "grid-cols-2" : "grid-cols-1")}>
          <button 
            onClick={() => { setIsAdding(true); setEditingExpense(null); setAmount(''); setDescription(''); }}
            className="group relative h-28 md:h-32 bg-slate-900 rounded-[2rem] overflow-hidden transition-all active:scale-95 shadow-lg"
          >
            <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="relative h-full flex flex-col items-center justify-center gap-2">
              <div className="w-10 h-10 md:w-12 md:h-12 bg-white rounded-full flex items-center justify-center">
                <Minus className="w-5 h-5 md:w-6 md:h-6 text-slate-900" />
              </div>
              <span className="text-white font-black uppercase tracking-widest text-[10px] md:text-xs">Ghi chi tiêu</span>
            </div>
          </button>

          {isAdmin && (
            <button 
              onClick={() => { setIsAddingMoney(true); setEditingExpense(null); setAmount(''); setDescription(''); }}
              className="group relative h-28 md:h-32 bg-white border border-slate-200 rounded-[2rem] overflow-hidden transition-all active:scale-95 shadow-sm"
            >
              <div className="absolute inset-0 bg-slate-50 opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative h-full flex flex-col items-center justify-center gap-2">
                <div className="w-10 h-10 md:w-12 md:h-12 bg-slate-100 rounded-full flex items-center justify-center">
                  <Plus className="w-5 h-5 md:w-6 md:h-6 text-slate-900" />
                </div>
                <span className="text-slate-900 font-black uppercase tracking-widest text-[10px] md:text-xs">Thêm tiền</span>
              </div>
            </button>
          )}
        </div>

        {/* History */}
        <div className="space-y-6 md:space-y-8">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4 md:pb-6">
            <h3 className="text-lg md:text-xl font-black italic tracking-tight flex items-center gap-3 uppercase">
              <History className="w-5 h-5 md:w-6 md:h-6 text-slate-300" />
              Hoạt động
            </h3>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest bg-slate-50 px-3 py-1 rounded-full">
              {expenses.length} Giao dịch
            </span>
          </div>

          <div className="space-y-3 md:space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
            {expenses.length === 0 ? (
              <div className="text-center py-16 md:py-20 bg-slate-50 rounded-[2rem] border border-dashed border-slate-200">
                <p className="text-slate-400 font-medium">Chưa có hoạt động nào gần đây.</p>
              </div>
            ) : (
              paginatedExpenses.map((exp) => (
                <motion.div key={exp.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                  <div className="group flex items-center justify-between p-4 md:p-5 bg-white rounded-[1.5rem] md:rounded-[2rem] border border-slate-100 hover:border-slate-200 transition-all shadow-sm">
                    <div className="flex items-start md:items-center gap-3 md:gap-6">
                      <div className={cn(
                        "w-10 h-10 md:w-14 md:h-14 rounded-xl md:rounded-2xl flex items-center justify-center flex-shrink-0 mt-1 md:mt-0",
                        exp.type === 'expense' ? "bg-red-50" : "bg-emerald-50"
                      )}>
                        {exp.type === 'expense' ? <TrendingDown className="w-5 h-5 md:w-7 md:h-7 text-red-500" /> : <TrendingUp className="w-5 h-5 md:w-7 md:h-7 text-emerald-500" />}
                      </div>
                      <div className="min-w-0 flex flex-col">
                        <div className="font-bold text-sm md:text-lg mb-0.5 truncate">{exp.description}</div>
                        <div className="text-[9px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 md:mb-0">
                          {format(new Date(exp.date), 'dd/MM • HH:mm')}
                        </div>
                        {/* Amount on mobile */}
                        <div className={cn("text-base font-black tabular-nums md:hidden", exp.type === 'expense' ? "text-slate-900" : "text-emerald-600")}>
                          {exp.type === 'expense' ? '-' : '+'} {formatCurrency(exp.amount).replace('₫', '')}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 md:gap-4 flex-shrink-0">
                      {/* Amount on desktop */}
                      <div className={cn("hidden md:block text-2xl font-black tabular-nums", exp.type === 'expense' ? "text-slate-900" : "text-emerald-600")}>
                        {exp.type === 'expense' ? '-' : '+'} {formatCurrency(exp.amount).replace('₫', '')}
                      </div>
                      {isAdmin && (
                        <div className="flex items-center gap-0.5 md:gap-2 md:opacity-0 group-hover:opacity-100 transition-all">
                          <button onClick={() => handleStartEditExpense(exp)} className="p-1.5 text-slate-300 hover:text-slate-900">
                            <Edit2 className="w-3.5 h-3.5 md:w-4 h-4" />
                          </button>
                          <button onClick={() => handleDeleteExpense(exp)} className="p-1.5 text-slate-300 hover:text-red-500">
                            <Trash2 className="w-4 h-4 md:w-5 h-5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))
            )}
            
            {hasMore && (
              <div className="pt-4 text-center">
                <button 
                  onClick={() => setCurrentPage(prev => prev + 1)}
                  className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 hover:text-slate-900 transition-colors"
                >
                  Xem thêm giao dịch
                </button>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Modals */}
      <AnimatePresence>
        {(isAdding || isAddingMoney || isEditingBalance) && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6 bg-slate-900/40 backdrop-blur-md">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="w-full max-w-md">
              <Card className="bg-white border-slate-200 p-8 md:p-10 shadow-2xl">
                <div className="flex items-center justify-between mb-8 md:mb-10">
                  <h2 className="text-2xl md:text-3xl font-black italic tracking-tighter uppercase">
                    {isEditingBalance ? 'Sửa số dư' : editingExpense ? 'Sửa giao dịch' : isAdding ? 'Ghi chi tiêu' : 'Thêm tiền'}
                  </h2>
                  <button onClick={() => { setIsAdding(false); setIsAddingMoney(false); setIsEditingBalance(false); setAmount(''); setEditingExpense(null); }} className="p-2 md:p-3 hover:bg-slate-50 rounded-2xl">
                    <X className="w-6 h-6 text-slate-400" />
                  </button>
                </div>

                <div className="space-y-6 md:space-y-8">
                  <div className="space-y-2 md:space-y-3">
                    <label className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 ml-2">Số tiền (VND)</label>
                    <input 
                      type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" autoFocus
                      className="w-full bg-slate-50 border border-slate-200 rounded-3xl px-6 md:px-8 py-4 md:py-6 text-3xl md:text-4xl font-black tabular-nums focus:outline-none focus:border-slate-900 transition-all placeholder:text-slate-200"
                    />
                  </div>
                  {!isEditingBalance && (
                    <div className="space-y-2 md:space-y-3">
                      <label className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 ml-2">Ghi chú</label>
                      <input 
                        type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Mục đích là gì?"
                        className="w-full bg-slate-50 border border-slate-200 rounded-3xl px-6 md:px-8 py-4 md:py-5 font-bold focus:outline-none focus:border-slate-900 transition-all"
                      />
                    </div>
                  )}
                  <Button 
                    onClick={() => isEditingBalance ? handleEditBalance() : handleTransaction(isAdding ? 'expense' : 'income')}
                    className="w-full py-4 md:py-6 text-lg md:text-xl rounded-3xl mt-4 uppercase" disabled={!amount}
                  >
                    Xác nhận
                  </Button>
                </div>
              </Card>
            </motion.div>
          </motion.div>
        )}

        {showSettings && isAdmin && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6 bg-slate-900/40 backdrop-blur-md">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="w-full max-w-md">
              <Card className="bg-white border-slate-200 p-8 md:p-10 shadow-2xl">
                <div className="flex items-center justify-between mb-8 md:mb-10">
                  <h2 className="text-2xl md:text-3xl font-black italic tracking-tighter uppercase">Cài đặt</h2>
                  <button onClick={() => setShowSettings(false)} className="p-2 md:p-3 hover:bg-slate-50 rounded-2xl">
                    <X className="w-6 h-6 text-slate-400" />
                  </button>
                </div>

                <div className="space-y-8 md:space-y-10">
                  <div className="space-y-6">
                    <div className="flex items-center gap-3 text-slate-400">
                      <Bell className="w-5 h-5" />
                      <span className="text-[10px] font-black uppercase tracking-[0.2em]">Thông báo qua Email</span>
                    </div>
                    
                    <div className="space-y-2 md:space-y-3">
                      {notifSettings?.emails.map(email => (
                        <div key={email} className="flex items-center justify-between p-4 md:p-5 bg-slate-50 rounded-2xl border border-slate-100">
                          <span className="font-bold text-xs md:text-sm truncate mr-2">{email}</span>
                          <button onClick={() => handleRemoveEmail(email)} className="text-red-400 hover:text-red-600 p-1 flex-shrink-0">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="flex gap-2 md:gap-3">
                      <input 
                        type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Email..."
                        className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-4 md:px-6 py-3 md:py-4 text-sm font-bold focus:outline-none focus:border-slate-900"
                      />
                      <button onClick={handleAddEmail} className="bg-slate-900 text-white px-4 md:px-6 rounded-2xl font-bold hover:bg-slate-800 text-sm">
                        Thêm
                      </button>
                    </div>
                    <div className="space-y-4 pt-4 border-t border-slate-100">
                      <div className="flex items-center gap-3 text-slate-400">
                        <Settings className="w-5 h-5" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em]">Cấu hình EmailJS</span>
                      </div>
                      
                      <div className="space-y-4">
                        <div className="space-y-1">
                          <label className="text-[9px] font-black uppercase tracking-[0.1em] text-slate-400 ml-1">Service ID</label>
                          <input 
                            type="text" 
                            value={notifSettings?.emailjsServiceId || ''} 
                            onChange={(e) => {
                              if (!notifSettings) return;
                              const updated = { ...notifSettings, emailjsServiceId: e.target.value };
                              setNotifSettings(updated);
                              updateDoc(doc(db, 'settings', SHARED_SETTINGS_ID), { emailjsServiceId: e.target.value });
                            }}
                            placeholder="service_xxxxxxx"
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold focus:outline-none focus:border-slate-900"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] font-black uppercase tracking-[0.1em] text-slate-400 ml-1">Template ID</label>
                          <input 
                            type="text" 
                            value={notifSettings?.emailjsTemplateId || ''} 
                            onChange={(e) => {
                              if (!notifSettings) return;
                              const updated = { ...notifSettings, emailjsTemplateId: e.target.value };
                              setNotifSettings(updated);
                              updateDoc(doc(db, 'settings', SHARED_SETTINGS_ID), { emailjsTemplateId: e.target.value });
                            }}
                            placeholder="template_xxxxxxx"
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold focus:outline-none focus:border-slate-900"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] font-black uppercase tracking-[0.1em] text-slate-400 ml-1">Public Key</label>
                          <input 
                            type="text" 
                            value={notifSettings?.emailjsPublicKey || ''} 
                            onChange={(e) => {
                              if (!notifSettings) return;
                              const updated = { ...notifSettings, emailjsPublicKey: e.target.value };
                              setNotifSettings(updated);
                              updateDoc(doc(db, 'settings', SHARED_SETTINGS_ID), { emailjsPublicKey: e.target.value });
                            }}
                            placeholder="Public Key của bạn"
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold focus:outline-none focus:border-slate-900"
                          />
                        </div>
                      </div>
                    </div>

                    <p className="text-[10px] text-slate-400 font-medium leading-relaxed">
                      Thông báo sẽ được gửi đến các địa chỉ này mỗi khi số dư thay đổi.
                    </p>
                  </div>

                  <div className="pt-6 md:pt-8 border-t border-slate-100">
                    <Button onClick={() => setShowSettings(false)} variant="secondary" className="w-full">
                      Đóng
                    </Button>
                  </div>
                </div>
              </Card>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BudgetTracker />
    </ErrorBoundary>
  );
}
