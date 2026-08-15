/** Physique 57 org structure — departments and employees used for auto-routing. */

export type DepartmentSeed = { id: string; name: string; description: string };

export const DEPARTMENTS: DepartmentSeed[] = [
  { id: "accounts", name: "Accounts", description: "Accounts routing queue" },
  { id: "customer-service", name: "Customer Service", description: "Customer Service routing queue" },
  { id: "management", name: "Management", description: "Management routing queue" },
  { id: "marketing", name: "Marketing", description: "Marketing routing queue" },
  { id: "operations", name: "Operations", description: "Operations routing queue" },
  { id: "sales-client-servicing", name: "Sales & Client Servicing", description: "Sales & Client Servicing routing queue" },
  { id: "training", name: "Training", description: "Training routing queue" },
];

export type EmployeeSeed = {
  id: string;
  name: string;
  email: string | null;
  department: string;
  role: string;
  location: string;
  manager: string;
};

export const EMPLOYEES: EmployeeSeed[] = [
  { id: "accounts-physique57mumbai-com", name: "Sagar Ingole", email: "accounts@physique57mumbai.com", department: "Operations", role: "Associate", location: "Physique 57, Mumbai", manager: "Zahur Shaikh" },
  { id: "akshay-physique57mumbai-com", name: "Akshay Rane", email: "akshay@physique57mumbai.com", department: "Sales & Client Servicing", role: "Sr. Sales & Client Servicing Associate", location: "Physique 57, Mumbai", manager: "Jimmeey Gondaa" },
  { id: "anisha-physique57india-com", name: "Anisha Shah", email: "anisha@physique57india.com", department: "Training", role: "Master Trainer", location: "India", manager: "Mallika Parekh" },
  { id: "api-physique57bengaluru-com", name: "Api Serou", email: "api@physique57bengaluru.com", department: "Sales & Client Servicing", role: "Sales & Client Servicing Associate", location: "Physique 57, Bengaluru", manager: "Shifa Ali" },
  { id: "deesha-physique57mumbai-com", name: "Deesha Changwani", email: "deesha@physique57mumbai.com", department: "Sales & Client Servicing", role: "Sales & Client Servicing Associate", location: "Physique 57, Bandra", manager: "Jimmeey Gondaa" },
  { id: "gaurav-physique57mumbai-com", name: "Gaurav Sogam", email: "gaurav@physique57mumbai.com", department: "Accounts", role: "Accounts Assistant", location: "Physique 57, Mumbai", manager: "Sachin Nalawade" },
  { id: "imran-physique57mumbai-com", name: "Imran Shaikh", email: "imran@physique57mumbai.com", department: "Sales & Client Servicing", role: "Sr. Sales & Client Servicing Associate", location: "Physique 57, Bandra", manager: "Jimmeey Gondaa" },
  { id: "jhanavi-physique57india-com", name: "Jhanvi Chhaya", email: "Jhanavichhaya11@gmail.com", department: "Marketing", role: "Social Media", location: "Physique 57, India", manager: "Reyna" },
  { id: "jimmeey-physique57india-com", name: "Jimmeey Gondaa", email: "jimmeey@physique57india.com", department: "Sales & Client Servicing", role: "Head of Sales & Client Servicing", location: "India", manager: "Mitali Kumar" },
  { id: "mallika-physique57india-com", name: "Mallika Parekh", email: "mallika@physique57india.com", department: "Management", role: "Owner", location: "India", manager: "Board" },
  { id: "mitali-physique57india-com", name: "Mitali Kumar", email: "mitali@physique57india.com", department: "Management", role: "Chief Operations Officer", location: "India", manager: "Mallika Parekh" },
  { id: "mrigakshi-physique57mumbai-com", name: "Mrigakshi Jaiswal", email: "mrigakshi@physique57mumbai.com", department: "Training", role: "Head Trainer", location: "Mumbai", manager: "Anisha Shah" },
  { id: "nadiya-physique57mumbai-com", name: "Nadiya Shaikh", email: "nadiya@physique57mumbai.com", department: "Sales & Client Servicing", role: "Sales & Client Servicing Associate", location: "Physique 57, Mumbai", manager: "Jimmeey Gondaa" },
  { id: "prathap-physique57bengaluru-com", name: "Prathap K P", email: "prathap@physique57bengaluru.com", department: "Sales & Client Servicing", role: "Sales & Client Servicing Associate", location: "Physique 57, Bengaluru", manager: "Shifa Ali" },
  { id: "pujal-physique57mumbai-com", name: "Pujal Jathar", email: "pujal@physique57mumbai.com", department: "Accounts", role: "Sr. Finance & Accounts Executive", location: "Physique 57, Bengaluru", manager: "Sachin Nalawade" },
  { id: "pushyank-physique57bengaluru-com", name: "Pushyank Nahar", email: "pushyank@physique57bengaluru.com", department: "Training", role: "Head Trainer", location: "Bengaluru", manager: "Anisha Shah" },
  { id: "rasika-physique57mumbai-com", name: "Rasika Kalambe", email: "rasika@physique57mumbai.com", department: "Accounts", role: "Accounts Executive", location: "Physique 57, Bengaluru", manager: "Sachin Nalawade" },
  { id: "reyna-physique57india-com", name: "Reyna Jagtiani", email: "jagtianireyna@gmail.com", department: "Marketing", role: "Marketing Lead", location: "Physique 57, India", manager: "Mitali Kumar" },
  { id: "saachi-physique57india-com", name: "Saachi Shetty", email: "saachi@physique57india.com", department: "Operations", role: "Ops Manager", location: "India", manager: "Mitali Kumar" },
  { id: "saachi-s-physique57bengaluru-com", name: "Saachi Shetty Jr", email: "saachi.s@physique57bengaluru.com", department: "Marketing", role: "Marketing Lead", location: "Bengaluru", manager: "Shifa Ali" },
  { id: "sachin-physique57mumbai-com", name: "Sachin Nalawade", email: "sachin@physique57mumbai.com", department: "Accounts", role: "Accounts Head", location: "Physique 57, India", manager: "Mitali Kumar" },
  { id: "sashi-physique57bengaluru-com", name: "Sashi Singh", email: "sashi@physique57bengaluru.com", department: "Sales & Client Servicing", role: "Sales & Client Servicing Associate", location: "Physique 57, Bengaluru", manager: "Shifa Ali" },
  { id: "sheetal-physique57mumbai-com", name: "Sheetal Kataria", email: "sheetal@physique57mumbai.com", department: "Sales & Client Servicing", role: "Sales & Client Servicing Associate", location: "Physique 57, Mumbai", manager: "Jimmeey Gondaa" },
  { id: "shifa-physique57bengaluru-com", name: "Shifa Ali", email: "shifa@physique57bengaluru.com", department: "Operations", role: "Regional Head of Ops - South", location: "Bengaluru", manager: "Mitali Kumar" },
  { id: "shipra-physique57mumbai-com", name: "Shipra Pinge", email: "shipra@physique57mumbai.com", department: "Sales & Client Servicing", role: "Sales & Client Servicing Associate", location: "Physique 57, Bandra", manager: "Jimmeey Gondaa" },
  { id: "tahira-physique57mumbai-com", name: "Taahira Sayyed", email: "tahira@physique57mumbai.com", department: "Sales & Client Servicing", role: "Sales & Client Servicing Associate", location: "Physique 57, Mumbai", manager: "Jimmeey Gondaa" },
  { id: "vahishta-physique57mumbai-com", name: "Vahishta Fitter", email: "vahishta@physique57mumbai.com", department: "Sales & Client Servicing", role: "Sales & Client Servicing Associate", location: "Physique 57, Mumbai", manager: "Jimmeey Gondaa" },
  { id: "vivaran-physique57mumbai-com", name: "Vivaran Dhasmana", email: "vivaran@physique57mumbai.com", department: "Training", role: "Head Trainer", location: "Mumbai", manager: "Anisha Shah" },
  { id: "yashas-physique57bengaluru-com", name: "Yashas K", email: "yashas@physique57bengaluru.com", department: "Sales & Client Servicing", role: "Sales & Client Servicing Associate", location: "Physique 57, Bengaluru", manager: "Shifa Ali" },
  { id: "zaheer-physique57mumbai-com", name: "Zaheer Agarbattiwala", email: "zaheer@physique57mumbai.com", department: "Sales & Client Servicing", role: "Sales & Client Servicing Associate", location: "Physique 57, Mumbai", manager: "Jimmeey Gondaa" },
  { id: "zahur-physique57mumbai-com", name: "Zahur Shaikh", email: "zahur@physique57mumbai.com", department: "Operations", role: "Studio Coordinator", location: "Physique 57, Mumbai", manager: "Saachi Shetty" },
];

/** Which department owns which ticket category. */
export const CATEGORY_DEPARTMENT: Record<string, string> = {
  Scheduling: "Operations",
  "Class Experience": "Training",
  "Trainer Feedback": "Training",
  "Repair and Maintenance": "Operations",
  "Studio Amenities and Facilities": "Operations",
  "Operating Systems": "Operations",
  "Tech Issues": "Operations",
  "Pricing and Memberships": "Accounts",
  "Customer Service and Communication": "Sales & Client Servicing",
  "Brand Feedback": "Marketing",
  "Safety and Security": "Management",
  "Theft and Lost Items": "Operations",
  Miscellaneous: "Operations",
};

/** Roles that should own a category first, in preference order. */
export const CATEGORY_ROLE_PREFERENCE: Record<string, string[]> = {
  Scheduling: ["Ops Manager", "Studio Coordinator", "Regional Head of Ops - South"],
  "Class Experience": ["Head Trainer", "Master Trainer"],
  "Trainer Feedback": ["Master Trainer", "Head Trainer"],
  "Repair and Maintenance": ["Studio Coordinator", "Ops Manager"],
  "Studio Amenities and Facilities": ["Studio Coordinator", "Ops Manager"],
  "Operating Systems": ["Ops Manager", "Regional Head of Ops - South"],
  "Tech Issues": ["Studio Coordinator", "Ops Manager"],
  "Pricing and Memberships": ["Accounts Head", "Sr. Finance & Accounts Executive", "Accounts Executive"],
  "Customer Service and Communication": ["Head of Sales & Client Servicing", "Sr. Sales & Client Servicing Associate"],
  "Brand Feedback": ["Marketing Lead", "Social Media"],
  "Safety and Security": ["Chief Operations Officer", "Owner", "Ops Manager"],
  "Theft and Lost Items": ["Ops Manager", "Studio Coordinator"],
  Miscellaneous: ["Ops Manager", "Studio Coordinator"],
};

const PALETTE = [
  "#6366f1", "#0ea5e9", "#14b8a6", "#f59e0b", "#ec4899",
  "#8b5cf6", "#10b981", "#ef4444", "#3b82f6", "#a855f7",
];

export function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

/** Map an employee location string onto a studio code. */
export function studioCodeForLocation(location: string): string | null {
  const l = location.toLowerCase();
  if (l.includes("bandra")) return "BAN";
  if (l.includes("bengaluru") || l.includes("bangalore")) return "IND";
  if (l.includes("mumbai")) return "KC";
  return null;
}

export function categoriesForEmployee(employee: EmployeeSeed): string[] {
  return Object.entries(CATEGORY_DEPARTMENT)
    .filter(([, dept]) => dept === employee.department)
    .map(([category]) => category);
}
